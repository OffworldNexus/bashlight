/** Wires the default wrapper strategies, in peeling order. */

import { DockerWrapper } from "./containers.ts";
import { DirenvWrapper } from "./direnv.ts";
import { EnvWrapper, SudoWrapper } from "./environment.ts";
import { KubectlWrapper } from "./kubectl.ts";
import { createPrefixWrappers, EvalWrapper, FlockWrapper } from "./prefix.ts";
import { ShellWrapper } from "./shells.ts";
import { SshWrapper } from "./ssh.ts";
import type { Wrapper } from "./types.ts";
import { WatchWrapper } from "./watch.ts";
import { FindWrapper, XargsWrapper } from "./xargs.ts";

export function createWrappers(): readonly Wrapper[] {
    return [
        new ShellWrapper(),
        new EnvWrapper(),
        new SudoWrapper(),
        ...createPrefixWrappers(),
        new EvalWrapper(),
        new FlockWrapper(),
        new XargsWrapper(),
        new FindWrapper(),
        new WatchWrapper(),
        new SshWrapper(),
        new DockerWrapper(),
        new KubectlWrapper(),
        new DirenvWrapper(),
    ];
}
