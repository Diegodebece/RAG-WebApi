import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getModelTurnWaitingCount, runWithModelTurnService } from "../../src/v1/services/modelTurn.service.js";
import { AppError } from "../../src/v1/utils/appError.util.js";
import { RequestCancelledError } from "../../src/v1/utils/requestCancelledError.util.js";

// a task that runs until the test releases it, so the test decides when each turn ends
const heldTask = () => {
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { release, task: () => released };
};

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

describe("runWithModelTurnService", () => {
    it("runs one task at a time, in arrival order", async () => {
        const order: string[] = [];
        const first = heldTask();

        const runs = [
            runWithModelTurnService(async () => {
                order.push("first starts");
                await first.task();
                order.push("first ends");
            }),
            runWithModelTurnService(async () => {
                order.push("second");
            }),
            runWithModelTurnService(async () => {
                order.push("third");
            })
        ];

        await nextTick();
        assert.deepEqual(order, ["first starts"]);
        assert.equal(getModelTurnWaitingCount(), 2);

        first.release();
        await Promise.all(runs);
        assert.deepEqual(order, ["first starts", "first ends", "second", "third"]);
        assert.equal(getModelTurnWaitingCount(), 0);
    });

    it("passes the turn on when a task fails", async () => {
        const failing = runWithModelTurnService(async () => {
            throw new Error("boom");
        });
        const next = runWithModelTurnService(async () => "ran");

        await assert.rejects(failing, /boom/);
        assert.equal(await next, "ran");
    });

    it("gives up with a 503 when the turn does not come in time, and leaves the line", async () => {
        const holder = heldTask();
        const holding = runWithModelTurnService(holder.task);
        let ran = false;

        const late = runWithModelTurnService(async () => {
            ran = true;
        }, { maxWaitMs: 50 });

        await assert.rejects(late, (error: unknown) => error instanceof AppError && error.status === 503);
        assert.equal(getModelTurnWaitingCount(), 0);

        holder.release();
        await holding;
        assert.equal(ran, false);
    });

    it("leaves the line when the caller is cancelled", async () => {
        const holder = heldTask();
        const holding = runWithModelTurnService(holder.task);
        const cancelled = new AbortController();
        let ran = false;

        const waiting = runWithModelTurnService(async () => {
            ran = true;
        }, { signal: cancelled.signal });

        await nextTick();
        assert.equal(getModelTurnWaitingCount(), 1);

        cancelled.abort();
        await assert.rejects(waiting, (error: unknown) => error instanceof RequestCancelledError);
        assert.equal(getModelTurnWaitingCount(), 0);

        holder.release();
        await holding;
        assert.equal(ran, false);
    });

    it("refuses a caller that was cancelled before asking", async () => {
        const cancelled = new AbortController();
        cancelled.abort();

        await assert.rejects(runWithModelTurnService(async () => {}, { signal: cancelled.signal }), (error: unknown) => error instanceof RequestCancelledError);
    });

    it("is free again once the line is empty", async () => {
        assert.equal(await runWithModelTurnService(async () => "free"), "free");
        assert.equal(getModelTurnWaitingCount(), 0);
    });
});
