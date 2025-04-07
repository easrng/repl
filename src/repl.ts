import * as t from "@babel/types";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
export class REPL {
    #scope: Record<string, unknown> = Object.create(null);
    eval(code: string) {
        const ast = parse("void 0;" + code, {
            createImportExpressions: true,
            sourceType: "module",
            strictMode: false,
        });
        let hasAsync = false;
        traverse(ast, {
            ImportDeclaration(path) {
                const { node } = path;
                const ns = node.specifiers.find((e) =>
                    e.type === "ImportNamespaceSpecifier"
                );
                path.replaceWith(
                    t.variableDeclaration("let", [
                        t.variableDeclarator(
                            ns
                                ? ns.local
                                : t.objectPattern(node.specifiers.map((e) => {
                                    if (
                                        e.type === "ImportNamespaceSpecifier"
                                    ) throw new Error("should never happen");
                                    return t.objectProperty(
                                        e.type === "ImportDefaultSpecifier"
                                            ? t.identifier("default")
                                            : e.imported,
                                        t.identifier(e.local.name),
                                    );
                                })),
                            t.awaitExpression(t.importExpression(
                                node.source,
                                node.attributes?.length
                                    ? t.objectExpression([
                                        t.objectProperty(
                                            t.identifier("with"),
                                            t.objectExpression(
                                                node.attributes.map((e) =>
                                                    t.objectProperty(
                                                        e.key,
                                                        e.value,
                                                    )
                                                ),
                                            ),
                                        ),
                                    ])
                                    : null,
                            )),
                        ),
                    ]),
                );
                hasAsync = true;
            },
            ClassDeclaration(path) {
                const node = path.node;
                if (path.parent.type !== "Program" || !node.id) return;
                path.replaceWith(
                    t.variableDeclaration("let", [
                        t.variableDeclarator(
                            t.identifier(node.id.name),
                            t.classExpression(
                                node.id,
                                node.superClass,
                                node.body,
                                node.decorators,
                            ),
                        ),
                    ]),
                );
            },
            Function(path) {
                path.skip();
            },
            ForAwaitStatement() {
                hasAsync = true;
            },
            AwaitExpression() {
                hasAsync = true;
            },
        });
        let scopeName: string;
        traverse(ast, {
            VariableDeclaration(path) {
                if (
                    path.node.kind === "var" || path.parent.type === "Program"
                ) {
                    path.replaceWith(
                        t.unaryExpression(
                            "void",
                            t.sequenceExpression(
                                path.node.declarations.map((e) =>
                                    t.assignmentExpression(
                                        "=",
                                        e.id,
                                        e.init ?? t.buildUndefinedNode(),
                                    )
                                ),
                            ),
                        ),
                    );
                }
            },
            Function(path) {
                path.skip();
            },
            Program: (path) => {
                for (const k of Object.keys(path.scope.bindings)) {
                    delete path.scope.bindings[k];
                    this.#scope[k] = void 0;
                }
            },
        });
        const rwId = (path: NodePath<t.Identifier | t.JSXIdentifier>) => {
            const { node } = path;
            const { name } = node;
            if (!(name in this.#scope)) return;
            if (path.scope.getBinding(name)) return;
            path.replaceWith(
                t.memberExpression(
                    t.identifier(scopeName),
                    t.identifier(name),
                ),
            );
        };
        traverse(ast, {
            Program: {
                enter(path) {
                    scopeName = path.scope.generateUid("scope");
                },
                exit(path) {
                    const completionRecords = path.getCompletionRecords();
                    const completion = path.scope.generateDeclaredUidIdentifier(
                        "completion",
                    );

                    for (const p of completionRecords) {
                        if (p.isExpressionStatement()) {
                            p.node.expression = t.assignmentExpression(
                                "=",
                                t.identifier(completion.name),
                                p.node.expression,
                            );
                        }
                    }

                    path.node.body.push(
                        t.returnStatement(t.identifier(completion.name)),
                    );

                    if (hasAsync) {
                        path.replaceWith(
                            t.program([
                                t.returnStatement(
                                    t.callExpression(
                                        t.arrowFunctionExpression(
                                            [],
                                            t.blockStatement(path.node.body),
                                            true,
                                        ),
                                        [],
                                    ),
                                ),
                            ]),
                        );
                    }
                    path.skip();
                },
            },
            ReferencedIdentifier: rwId,
            BindingIdentifier: rwId,
        });
        const transformed = generate(ast, {
            retainLines: true,
        }).code;
        return new Function(
            scopeName!,
            transformed,
        )(this.#scope);
    }
    get scope() {
        return this.#scope;
    }
}
