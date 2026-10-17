import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import type { RequestListener, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { closeServerGracefully } from "../src/shutdown.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const startServer = async (handler: RequestListener): Promise<{ server: Server; port: number }> => {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: (server.address() as AddressInfo).port };
};

// the status code, or the error message when the connection fails
const fetchStatus = (port: number): Promise<string> => new Promise((resolve) => {
    const req = get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        res.on("end", () => resolve(String(res.statusCode)));
    });
    req.on("error", (error) => resolve(error.message));
});

describe("closeServerGracefully", () => {
    it("lets a request in progress finish before the server closes", async () => {
        const { server, port } = await startServer((req, res) => {
            setTimeout(() => res.end("done"), 300);
        });
        const inProgress = fetchStatus(port);
        await sleep(50);

        await closeServerGracefully(server, () => {}, 5000);

        assert.equal(await inProgress, "200");
    });

    it("ends the event streams and refuses new connections", async () => {
        const { server, port } = await startServer((req, res) => res.end());
        let streamsEnded = false;

        await closeServerGracefully(server, () => {
            streamsEnded = true;
        }, 5000);

        assert.equal(streamsEnded, true);
        assert.match(await fetchStatus(port), /ECONNREFUSED/);
    });

    it("closes a request that outlasts the timeout, so the process can exit", { timeout: 5000 }, async () => {
        // a handler that never answers, like a stream that was not ended
        const { server, port } = await startServer(() => {});
        const stuck = fetchStatus(port);
        await sleep(50);
        const started = Date.now();

        await closeServerGracefully(server, () => {}, 200);

        assert.ok(Date.now() - started < 2000, "it did not wait for the stuck request");
        assert.match(await stuck, /socket hang up|ECONNRESET/);
    });
});
