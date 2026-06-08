import { Buffer } from "buffer";

globalThis.Buffer ??= Buffer;
globalThis.process ??= {};
globalThis.process.browser ??= true;
globalThis.process.env ??= {};
globalThis.process.version ??= "v18.0.0";
