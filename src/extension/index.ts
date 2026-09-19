import type NodeCG from "@nodecg/types";
import type {Configschema} from "../types/generated/configschema";
import {setupSpreadsheet} from "./spreadsheet";

export default function (nodecg: NodeCG.ServerAPI<Configschema>) {
	setupSpreadsheet(nodecg);
}
