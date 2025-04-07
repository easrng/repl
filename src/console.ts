/**
 * Portions of this of this code are based on code from Deno, which is licensed as follows:
 * MIT License
 * Copyright 2018-2024 the Deno authors
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {
    type Component,
    createContext,
    DocNode,
    render,
} from "@easrng/elements/tiny";
import inspect from "object-inspect";
type Log = {
    type: string;
    args: unknown[];
    time: number;
    stack?: string;
};
const DefaultFormat: Component<{ args: unknown[] }> = ({ args, html }) => {
    const first = args[0];
    let a = 0;
    let out: string[] = [];
    let styled: DocNode[] = [];
    let css: string = "";
    function flush() {
        if (out.length) {
            styled.push(
                css ? html`<span style=${css}>${out}</span>` : html`${out}`,
            );
            out = [];
        }
    }
    if (typeof first == "string" && args.length > 1) {
        a++;
        // Index of the first not-yet-appended character. Use this so we only
        // have to append to `string` when a substitution occurs / at the end.
        let appendedChars = 0;
        for (let i = 0; i < first.length - 1; i++) {
            if (first[i] == "%") {
                const char = first[++i];
                if (a < args.length) {
                    let formattedArg = "";
                    if (char == "s") {
                        // Format as a string.
                        formattedArg = String(args[a++]);
                    } else if (
                        Array.prototype.includes.call(["d", "i"], char)
                    ) {
                        // Format as an integer.
                        const value = args[a++];
                        if (typeof value == "bigint") {
                            formattedArg = `${value}n`;
                        } else if (typeof value == "number") {
                            formattedArg = `${Number.parseInt(String(value))}`;
                        } else {
                            formattedArg = "NaN";
                        }
                    } else if (char == "f") {
                        // Format as a floating point value.
                        const value = args[a++];
                        if (typeof value == "number") {
                            formattedArg = `${value}`;
                        } else {
                            formattedArg = "NaN";
                        }
                    } else if (
                        Array.prototype.includes.call(["O", "o"], char)
                    ) {
                        // Format as an object.
                        formattedArg = inspect(args[a++]);
                    } else if (char == "c") {
                        const value = String(args[a++]);
                        flush();
                        css = value;
                    }

                    if (formattedArg != null) {
                        out.push(
                            String.prototype.slice.call(
                                first,
                                appendedChars,
                                i - 1,
                            ) +
                                formattedArg,
                        );
                        appendedChars = i + 1;
                    }
                }
                if (char == "%") {
                    out.push(
                        String.prototype.slice.call(
                            first,
                            appendedChars,
                            i - 1,
                        ) + "%",
                    );
                    appendedChars = i + 1;
                }
            }
        }
        out.push(String.prototype.slice.call(first, appendedChars));
    }
    flush();
    css = "";

    for (; a < args.length; a++) {
        if (a > 0) {
            out.push(" ");
        }
        if (typeof args[a] == "string") {
            out.push(String(args[a]));
        } else {
            out.push(inspect(args[a]));
        }
    }
    flush();
    return html`<span class="message">${styled}</span>`;
};
function transpose<T>(matrix: readonly [T[], ...T[][]]): T[][] {
    return matrix[0].map((col, i) => matrix.map((row) => row[i]!));
}
const Table: Component<{ args: unknown[] }> = ({
    args: [data, properties],
    html,
}) => {
    if (
        (properties !== undefined && !Array.isArray(properties)) ||
        data === null ||
        typeof data !== "object"
    ) {
        return html`<${DefaultFormat} args=${[data, properties]} />`;
    }

    let resultData: (Array<unknown> | Record<string, unknown>) & {
        [_: string]: unknown;
    };
    const isSetObject = data instanceof Set;
    const isMapObject = data instanceof Map;
    const valuesKey = "Values";
    const indexKey = isSetObject || isMapObject ? "(iter idx)" : "(idx)";

    if (isSetObject) {
        resultData = [...data] as any;
    } else if (isMapObject) {
        let idx = 0;
        resultData = {};

        Map.prototype.forEach.call(data, (v, k) => {
            resultData[idx] = { Key: k, Values: v };
            idx++;
        });
    } else {
        resultData = data as any;
    }

    const keys = Object.keys(resultData);
    const numRows = keys.length;

    const objectValues = properties
        ? Object.fromEntries(
            properties.map((name) => [
                String(name),
                Array.prototype.fill.call(new Array(numRows), ""),
            ]),
        )
        : {};
    const indexKeys: unknown[] = [];
    const values: (DocNode | string)[] = [];

    let hasPrimitives = false;
    keys.forEach((k, idx) => {
        const value = resultData[k];
        const primitive = value === null ||
            (typeof value !== "function" && typeof value !== "object");
        if (properties === undefined && primitive) {
            hasPrimitives = true;
            values.push(html`<${DefaultFormat} args=${[value]} />`);
        } else {
            const valueObj: Record<string, unknown> = (value || {}) as any;
            const keys = properties || Object.keys(valueObj);
            for (let i = 0; i < keys.length; ++i) {
                const k = keys[i];
                if (!primitive && Reflect.has(valueObj, k)) {
                    if (!Reflect.has(objectValues, k)) {
                        objectValues[k] = new Array(numRows).fill("");
                    }
                    objectValues[k]![idx] = html`<${DefaultFormat}
                args=${[valueObj[k]]}
              />`;
                }
            }
            values.push("");
        }

        indexKeys.push(k);
    });

    const headerKeys = Object.keys(objectValues);
    const bodyValues = Object.values(objectValues);
    const headerProps = properties || [
        ...headerKeys,
        !isMapObject && hasPrimitives && valuesKey,
    ];
    const header = Array.prototype.filter.call(
        [indexKey, ...headerProps],
        Boolean,
    );
    const body = [indexKeys, ...bodyValues, values] as const;
    return html`
        <div class="message">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  ${header.map((e) => html`<th>${e}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${
        transpose(body).map(
            (e) =>
                html`
                    <tr>
                      ${
                    e
                        .slice(0, header.length)
                        .map((e, i) =>
                            i ? html`<td>${e}</td>` : html`<th>${e}</th>`
                        )
                }
                    </tr>
                  `,
        )
    }
              </tbody>
            </table>
          </div>
        </div>
      `;
};
const icons: Record<string, string> = {
    error:
        "M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm0-160q17 0 28.5-11.5T520-480v-160q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640v160q0 17 11.5 28.5T480-440Zm0 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
    warn:
        "M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm69-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm0-120q17 0 28.5-11.5T520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360Zm0-100Z",
    info:
        "M480-280q17 0 28.5-11.5T520-320v-160q0-17-11.5-28.5T480-520q-17 0-28.5 11.5T440-480v160q0 17 11.5 28.5T480-280Zm0-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
    debug:
        "M480-120q-65 0-120.5-32T272-240h-72q-17 0-28.5-11.5T160-280q0-17 11.5-28.5T200-320h44q-3-20-3.5-40t-.5-40h-40q-17 0-28.5-11.5T160-440q0-17 11.5-28.5T200-480h40q0-20 .5-40t3.5-40h-44q-17 0-28.5-11.5T160-600q0-17 11.5-28.5T200-640h72q14-23 31.5-43t40.5-35l-37-38q-11-11-11-27.5t12-28.5q11-11 28-11t28 11l58 58q28-9 57-9t57 9l60-59q11-11 27.5-11t28.5 12q11 11 11 28t-11 28l-38 38q23 15 41.5 34.5T688-640h72q17 0 28.5 11.5T800-600q0 17-11.5 28.5T760-560h-44q3 20 3.5 40t.5 40h40q17 0 28.5 11.5T800-440q0 17-11.5 28.5T760-400h-40q0 20-.5 40t-3.5 40h44q17 0 28.5 11.5T800-280q0 17-11.5 28.5T760-240h-72q-32 56-87.5 88T480-120Zm0-80q66 0 113-47t47-113v-160q0-66-47-113t-113-47q-66 0-113 47t-47 113v160q0 66 47 113t113 47Zm-40-120h80q17 0 28.5-11.5T560-360q0-17-11.5-28.5T520-400h-80q-17 0-28.5 11.5T400-360q0 17 11.5 28.5T440-320Zm0-160h80q17 0 28.5-11.5T560-520q0-17-11.5-28.5T520-560h-80q-17 0-28.5 11.5T400-520q0 17 11.5 28.5T440-480Zm40 40Z",
    unknown:
        "M584-637q0-43-28.5-69T480-732q-29 0-52.5 12.5T387-683q-16 23-43.5 26.5T296-671q-14-13-15.5-32t9.5-36q32-48 81.5-74.5T480-840q97 0 157.5 55T698-641q0 45-19 81t-70 85q-37 35-50 54.5T542-376q-4 24-20.5 40T482-320q-23 0-39.5-15.5T426-374q0-39 17-71.5t57-68.5q51-45 67.5-69.5T584-637ZM480-80q-33 0-56.5-23.5T400-160q0-33 23.5-56.5T480-240q33 0 56.5 23.5T560-160q0 33-23.5 56.5T480-80Z",
    output:
        "m313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z",
    input:
        "M442-480 287-697q-14-20-3.5-41.5T319-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Zm238 0L525-697q-14-20-3.5-41.5T557-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Z",
};
const known = new Set([
    "log",
    "clear",
    "table",
    "assert",
    "count",
    "countReset",
    "dir",
    "dirxml",
    "exception",
    "time",
    "timeEnd",
    "timeLog",
    "timeStamp",
    "trace",
    "profile",
    "profileEnd",
    ...Object.keys(icons),
]);
const TimesContext = createContext<Map<string, number>>();
const CountsContext = createContext<Map<string, number>>();
const LogLine: Component<{ log: Log }> = ({ log, html, context }) => {
    const times = context(TimesContext)!;
    const counts = context(CountsContext)!;
    let stackEle: Node | string = "";
    let unknownType: string | void;
    if (!known.has(log.type)) {
        unknownType = log.type;
        log.type = "unknown";
    }
    if (
        log.type === "timeStamp" ||
        log.type === "profile" ||
        log.type === "profileEnd"
    ) {
        return "";
    }
    if (log.type === "assert") {
        if (log.args[0]) return "";
        log.type = "error";
        log.args[0] = "Assertion failed:";
        log.args.push("\n" + log.stack);
    }
    const label = log.args[0] === undefined ? "default" : `${log.args[0]}`;
    {
        const reset = log.type === "countReset";
        if (log.type === "count" || log.type === "countReset") {
            const newCount = reset ? 0 : (counts.get(label) || 0) + 1;
            counts.set(label, newCount);
            if (reset) return "";
            log.args = [label + ":", newCount];
            log.type = "count";
        }
    }
    if (log.type === "time" || log.type === "countReset") {
        if (times.has(label)) {
            log.type = "warn";
            log.args = [`Timer '${label}' already exists.`];
        } else {
            times.set(label, log.time);
            return "";
        }
    }
    if (log.type === "timeLog" || log.type === "timeEnd") {
        if (times.has(label)) {
            log.args = [`${label}: ${log.time - times.get(label)!}ms`];
            if (log.type === "timeEnd") {
                times.delete(label);
            }
        } else {
            log.type = "warn";
            log.args = [`Timer '${label}' doesn't exist.`];
        }
    }
    if (log.type === "dir" || log.type === "dirxml") {
        log.type = "log";
    }
    if (log.type === "exception") {
        log.type = "error";
    }
    if (log.type === "trace") {
        log.args.unshift("Trace" + (log.args.length ? ":" : ""));
        log.args.push("\n" + log.stack);
    }
    const icon = icons[log.type]
        ? html`<svg ref=${{
            set value(v: SVGElement) {
                v.setAttribute("viewBox", "0 -960 960 960");
            },
        }} class="icon" aria-label=${log.type} title=${log.type}><path d=${
            icons[log.type]
        }/></svg>`
        : "";
    let content: DocNode;
    if (log.type === "clear") {
        content = html`<i class="message">Ignored console.clear()</i>`;
    } else if (log.type === "table") {
        content = html`<${Table} args=${log.args} />`;
    } else if (log.type === "unknown") {
        content = html`<b>${unknownType!}</b>: <${DefaultFormat}
            args=${log.args}
          />`;
    } else {
        content = html`<${DefaultFormat} args=${log.args} />`;
    }
    return html`
        <li class=${"log log-" + log.type}>${icon} ${content} ${stackEle}</li>
      `;
};
class ConsoleLogs extends HTMLElement {
    #times?: Map<string, number>;
    #counts?: Map<string, number>;
    constructor() {
        super();
        this.textContent = "";
        const ul = document.createElement("ul");
        this.append(ul);
        this.#times = new Map();
        this.#counts = new Map();
    }
    add(log: Log) {
        this.firstElementChild!.append(
            render(
                ({ html }) =>
                    html`
            <${TimesContext} value=${this.#times}>
              <${CountsContext} value=${this.#counts}>
                <${LogLine} log=${log} />
              </CountsContext>
            </TimesContext>`,
            ),
        );
    }
}
customElements.define("easrng-console-logs", ConsoleLogs);
declare global {
    interface HTMLElementTagNameMap {
        "easrng-console-logs": ConsoleLogs;
    }
}
