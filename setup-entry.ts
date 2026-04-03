import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { ncLocalImPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(ncLocalImPlugin);

