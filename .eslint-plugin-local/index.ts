import { AST_NODE_TYPES, ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import * as typescript from 'typescript';
import * as tsutils from 'tsutils';

type Options = [
	{
		interfaceEndings: string[];
	},
];

function shouldRun(eslNode: TSESTree.TSPropertySignature, interfaceEndings: string[]): boolean {
	// The first parent is the TSInterfaceBody, the second is the TSInterfaceDeclaration
	const interfaceNode = eslNode.parent?.parent;
	if (!(interfaceNode && 'id' in interfaceNode && interfaceNode.id?.type === AST_NODE_TYPES.Identifier)) {
		return false;
	}

	const { name } = interfaceNode.id;
	if (typeof name !== 'string') {
		return false;
	}

	return interfaceEndings.some((ending) => name.endsWith(ending));
}

const schema = [
	{
		type: 'object',
		properties: {
			interfaceEndings: {
				type: 'array',
				items: {
					type: 'string',
				},
			},
		},
	},
] as const;

const REST_TYPE_NAME_REGEX =
	/^REST(?:Get|Patch|Post|Put|Delete)[a-zA-Z0-9]+(?:JSONBody|FormDataBody|URLEncodedData|Result|Query)$/;

export = {
	rules: {
		'explicitly-optional-undefined-properties': ESLintUtils.RuleCreator.withoutDocs<Options, 'missingOptional'>({
			create: (context) => {
				const { interfaceEndings } = context.options[0];
				return {
					TSPropertySignature: (eslNode) => {
						if (!shouldRun(eslNode, interfaceEndings)) {
							return;
						}

						if (eslNode.optional) {
							return;
						}

						const parserServices = ESLintUtils.getParserServices(context);
						const checker = parserServices.program.getTypeChecker();
						const tsNode = parserServices.esTreeNodeToTSNodeMap.get(eslNode);
						const type = checker.getApparentType(checker.getTypeAtLocation(tsNode));
						const unionParts = tsutils.unionTypeParts(type);

						// If our prop is not optional, but has undefined in its union, we should report
						if (!unionParts.some((ty) => tsutils.isTypeFlagSet(ty, typescript.TypeFlags.Undefined))) {
							return;
						}

						context.report({
							node: eslNode,
							messageId: 'missingOptional',
							fix: (fixer) => fixer.insertTextAfter(eslNode.key, '?'),
						});
					},
				};
			},
			meta: {
				fixable: 'code',
				messages: {
					missingOptional: 'When a property has `| undefined`, it should be marked as optional.',
				},
				type: 'problem',
				schema: schema,
			},
			defaultOptions: [{ interfaceEndings: [] }],
		}),
		'explicit-undefined-on-optional-properties': ESLintUtils.RuleCreator.withoutDocs<Options, 'missingUndefined'>({
			create: (context) => {
				const { interfaceEndings } = context.options[0];
				return {
					// This is done naively because type-checking the node will always include `| undefined`
					// due to it being optional. ideally, we'd have a way to get the type of the node disregarding
					// the optional flag, which would make this check a lot more trivial
					TSPropertySignature: (eslNode) => {
						if (!shouldRun(eslNode, interfaceEndings)) {
							return;
						}

						// If our prop is't optional or if it doesn't have a type annotation, we don't need to do anything
						if (!eslNode.optional || !eslNode.typeAnnotation) {
							return;
						}

						const { typeAnnotation } = eslNode.typeAnnotation;
						switch (typeAnnotation.type) {
							case AST_NODE_TYPES.TSUnionType: {
								if (typeAnnotation.types.some((t) => t.type === AST_NODE_TYPES.TSUndefinedKeyword)) {
									return;
								}

								break;
							}

							case AST_NODE_TYPES.TSUndefinedKeyword: {
								return;
							}
						}

						context.report({
							node: eslNode,
							messageId: 'missingUndefined',
							fix: (fixer) => fixer.insertTextAfter(eslNode.typeAnnotation!, ' | undefined'),
						});
					},
				};
			},
			meta: {
				fixable: 'code',
				messages: {
					missingUndefined: 'When a property is optional, explicitly include `undefined` in the union.',
				},
				type: 'suggestion',
				schema: schema,
			},
			defaultOptions: [{ interfaceEndings: [] }],
		}),
		'rest-type-naming-convention': ESLintUtils.RuleCreator.withoutDocs<[{ whitelist: string[] }], 'invalidName'>({
			create: (context) => {
				const { whitelist } = context.options[0];
				const whitelistSet = new Set(whitelist);

				return {
					'TSTypeAliasDeclaration, TSInterfaceDeclaration': (
						node: TSESTree.TSTypeAliasDeclaration | TSESTree.TSInterfaceDeclaration,
					) => {
						if (node.id.type !== AST_NODE_TYPES.Identifier) {
							return;
						}

						const { name } = node.id;
						if (whitelistSet.has(name)) {
							return;
						}

						if (!REST_TYPE_NAME_REGEX.test(name)) {
							context.report({
								node: node.id,
								messageId: 'invalidName',
								data: { name },
							});
						}
					},
				};
			},
			meta: {
				messages: {
					invalidName: `{{ name }} does not match REST type naming convention. Must match ${REST_TYPE_NAME_REGEX.source}.`,
				},
				type: 'problem',
				schema: [
					{
						type: 'object',
						properties: {
							whitelist: {
								type: 'array',
								items: {
									type: 'string',
								},
							},
						},
					},
				] as const,
			},
			defaultOptions: [{ whitelist: [] }],
		}),
	},
};
