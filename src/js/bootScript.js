// The receiver's script (INV-81 (4)): the build makes an IIFE of this file
// and puts it right after the markup (tools/fastStartup.mjs).
import { installBoot } from "./boot.js";

installBoot(window);
