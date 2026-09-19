import assert from "node:assert/strict";
import {test} from "node:test";
import {snapshotReplicant} from "../src/shared/replicant";

test("Proxyで包まれたReplicantの値を画面用に複製する", () => {
	const nested = new Proxy({name: "走者"}, {});
	const value = new Proxy({players: [nested]}, {});
	const snapshot = snapshotReplicant(value);
	assert.deepEqual(snapshot, {players: [{name: "走者"}]});
	nested.name = "更新";
	assert.equal(snapshot.players[0]!.name, "走者");
});
