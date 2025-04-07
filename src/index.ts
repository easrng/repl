import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightSpecialChars,
    keymap,
    rectangularSelection,
} from "@codemirror/view";
import {
    completionPath,
    javascript,
    javascriptLanguage,
} from "@codemirror/lang-javascript";
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    Completion,
    CompletionContext,
    completionKeymap,
    CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { REPL } from "./repl";
import "./console.ts";
import { EditorState } from "@codemirror/state";
import {
    bracketMatching,
    defaultHighlightStyle,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
const consoleElement = document.querySelector("easrng-console-logs")!;
globalThis.addEventListener("unhandledrejection", (event) => {
    const log = {
        type: "error",
        args: ["Uncaught (in promise) %o", event.reason],
        time: Date.now(),
        stack: new Error().stack,
    };
    consoleElement.add(log);
});
globalThis.addEventListener("error", (event) => {
    const log = {
        type: "error",
        args: ["%o", event.error],
        time: Date.now(),
        stack: new Error().stack,
    };
    consoleElement.add(log);
});
globalThis.console = new Proxy(console, {
    get(target, key) {
        const real: unknown = (target as any)[key];
        if (typeof real === "function" && typeof key === "string") {
            return function (this: Console, ...args: any[]) {
                const log = {
                    type: key,
                    args,
                    time: Date.now(),
                    stack: new Error().stack,
                };
                consoleElement.add(log);
                return real.call(this, ...args);
            };
        }
    },
});
const repl = new REPL();
function enumeratePropertyCompletions(
    obj: any,
    top: boolean,
): readonly Completion[] {
    let options: Completion[] = [], seen: Set<string> = new Set();
    for (let depth = 0;; depth++) {
        for (let name of (Object.getOwnPropertyNames || Object.keys)(obj)) {
            if (
                !/^[a-zA-Z_$\xaa-\uffdc][\w$\xaa-\uffdc]*$/.test(name) ||
                seen.has(name)
            ) continue;
            seen.add(name);
            let value;
            try {
                value = obj[name];
            } catch (_) {
                continue;
            }
            options.push({
                label: name,
                type: typeof value == "function"
                    ? (/^[A-Z]/.test(name)
                        ? "class"
                        : top
                        ? "function"
                        : "method")
                    : top
                    ? "variable"
                    : "property",
                boost: -depth,
            });
        }
        let next = Object.getPrototypeOf(obj);
        if (!next) return options;
        obj = next;
    }
}
const Identifier =
    /^(?=[$_\p{ID_Start}\\])(?:[$_\u200C\u200D\p{ID_Continue}]+|\\u[\da-fA-F]{4}|\\u\{[\da-fA-F]+\})+$/u;
/// Defines a [completion source](#autocomplete.CompletionSource) that
/// completes from the given scope object (for example `globalThis`).
/// Will enter properties of the object when completing properties on
/// a directly-named path.
function scopeCompletionSource(scopes: object[]): CompletionSource {
    return (context: CompletionContext) => {
        let path = completionPath(context);
        if (!path) return null;
        let options: Completion[] = [];
        scopes: for (const scope of scopes) {
            let target = scope;
            for (let step of path.path) {
                target = target[step];
                if (!target) continue scopes;
            }
            options.push(...enumeratePropertyCompletions(
                target,
                !path.path.length,
            ));
        }
        return {
            from: context.pos - path.name.length,
            options,
            validFor: Identifier,
        };
    };
}
let replHistory: string[] = [];
let historyIndex = -1;
const view = new EditorView({
    parent: document.getElementById("editor")!,
    extensions: [
        keymap.of([
            {
                key: "Mod-Enter",
                run: (c) => {
                    send();
                    return true;
                },
            },
            ...vscodeKeymap,
        ]),
        keymap.of([
            {
                key: "ArrowUp",
                run: () => {
                    if (historyIndex > 0) {
                        const code = view.state.doc.toString();
                        view.dispatch({
                            changes: {
                                from: 0,
                                to: code.length,
                                insert: replHistory[--historyIndex],
                            },
                        });
                        return true;
                    }
                    return false;
                },
            },
            {
                key: "ArrowDown",
                run: () => {
                    if (historyIndex < replHistory.length) {
                        const code = view.state.doc.toString();
                        view.dispatch({
                            changes: {
                                from: 0,
                                to: code.length,
                                insert: replHistory[++historyIndex] ?? "",
                            },
                        });
                        return true;
                    }
                    return false;
                },
            },
        ]),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightSelectionMatches(),
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
        ]),
        javascript(),
        javascriptLanguage.data.of({
            autocomplete: scopeCompletionSource([repl.scope, globalThis]),
        }),
    ],
});
document.getElementById("run")!.addEventListener("click", send);
async function send() {
    const code = view.state.doc.toString();
    if (!code.trim()) return;
    historyIndex = replHistory.push(code);
    view.dispatch({
        changes: { from: 0, to: code.length, insert: "" },
    });
    consoleElement.add({
        type: "input",
        args: ["%s", code],
        time: Date.now(),
    });
    try {
        let result = repl.eval(code);
        if (typeof result === "object" && result !== null && "then" in result) {
            result = await result;
        }
        consoleElement.add({
            type: "output",
            args: ["%o", result],
            time: Date.now(),
        });
    } catch (e) {
        consoleElement.add({
            type: "error",
            args: ["Uncaught %o", e],
            time: Date.now(),
        });
    }
}
