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
    Completion,
    CompletionContext,
    CompletionSource,
    startCompletion,
} from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { REPL } from "./repl";
import "./console.ts";
import { EditorState } from "@codemirror/state";
import {
    bracketMatching,
    defaultHighlightStyle,
    indentOnInput,
    syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Log } from "./console.ts";
const consoleElement = document.querySelector("easrng-console-logs")!;
let pointerDownSelection: string | undefined;
consoleElement.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") {
        e.preventDefault();
    }
    pointerDownSelection = getSelection()?.toString();
});
consoleElement.addEventListener("click", (e) => {
    const log: Log = (e.target as any).closest(".log")?.log;
    if (!log) return;
    if (pointerDownSelection !== getSelection()?.toString()) return;
    e.preventDefault();
    if (log.type === "input") {
        const str = log.args[1] as string;
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.toString().length,
                insert: str,
            },
            selection: { anchor: str.length, head: str.length },
        });
    } else {
        const tempval = log.args.length === 1
            ? log.args[0]
            : (log.args.length === 2 && log.args[0] === "%o" ||
                    log.args[0] === "Uncaught %o" ||
                    log.args[0] === "Uncaught (in promise) ")
            ? log.args[1]
            : log.args;
        let i = 0, name;
        while (
            ((name = `temp${i}`) in repl.scope) && repl.scope[name] !== tempval
        ) i++;
        repl.scope[name] = tempval;
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.toString().length,
                insert: name,
            },
            selection: { anchor: name.length, head: name.length },
        });
    }
});
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
console.log(
    "This JavaScript REPL is designed to be touch-friendly.\nTap log entries to assign them to a variable, or to edit and rerun code you already evaluated. Double-tap in the editor to bring up the autocomplete menu.",
);
const repl = new REPL();
function enumeratePropertyCompletions(
    obj: any,
    top: boolean,
): readonly Completion[] {
    let options: Completion[] = [], seen: Set<string> = new Set();
    for (let depth = 0;; depth++) {
        for (let name of (Object.getOwnPropertyNames || Object.keys)(obj)) {
            if (
                !Identifier.test(name) ||
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
        javascript(),
        javascriptLanguage.data.of({
            autocomplete: scopeCompletionSource([repl.scope, globalThis]),
        }),
    ],
});
view.dom.addEventListener("dblclick", () => {
    if (!getSelection()?.toString()) {
        startCompletion(view);
    }
});
const run = document.getElementById("run")!;
run.addEventListener("mousedown", (e) => e.preventDefault());
run.addEventListener("click", send);
async function send(e?: Event) {
    e?.preventDefault();
    const code = view.state.doc.toString();
    if (!code.trim()) return;
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
