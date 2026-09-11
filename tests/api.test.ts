import request from "supertest";

process.env.DB_PATH = ":memory:";
delete process.env.GEMINI_API_KEY; // force the rule-only path so tests don't hit the network

import { app } from "../src/server";

describe("LLD Practice Platform API", () => {
  it("lists seeded problems", async () => {
    const res = await request(app).get("/api/problems");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body.map((p: any) => p.id)).toContain("parking-lot");
  });

  it("404s for an unknown problem", async () => {
    const res = await request(app).get("/api/problems/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("runs the full practice loop: attempt -> submit -> evaluated -> history", async () => {
    const created = await request(app).post("/api/problems/vending-machine/attempts");
    expect(created.status).toBe(201);
    const attemptId = created.body.id;

    const submitted = await request(app)
      .post(`/api/attempts/${attemptId}/submissions`)
      .send({
        kind: "text",
        writeup:
          "The machine has an explicit State interface (Idle, HasMoney, Dispensing, OutOfStock). " +
          "Inventory tracks each Slot's item and count. Payment is abstracted so Cash and Card both implement a PaymentMethod interface. " +
          "On dispense, change is computed from inserted amount minus price.",
      });

    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("evaluated");
    expect(submitted.body.evaluation.source).toBe("rule");
    expect(submitted.body.evaluation.overallScore).toBeGreaterThan(0);

    const attempt = await request(app).get(`/api/attempts/${attemptId}`);
    expect(attempt.body.status).toBe("completed");
    expect(attempt.body.submissions).toHaveLength(1);

    const history = await request(app).get("/api/problems/vending-machine/history");
    expect(history.status).toBe(200);
    expect(history.body.some((h: any) => h.attemptId === attemptId)).toBe(true);
  });

  it("rejects a submission with an empty writeup", async () => {
    const created = await request(app).post("/api/problems/elevator-system/attempts");
    const res = await request(app)
      .post(`/api/attempts/${created.body.id}/submissions`)
      .send({ kind: "text", writeup: "   " });
    expect(res.status).toBe(400);
  });

  it("404s when submitting to a non-existent attempt", async () => {
    const res = await request(app)
      .post("/api/attempts/does-not-exist/submissions")
      .send({ kind: "text", writeup: "class Foo {}" });
    expect(res.status).toBe(404);
  });

  it("refuses to retry a submission that has not failed", async () => {
    const created = await request(app).post("/api/problems/parking-lot/attempts");
    const submitted = await request(app)
      .post(`/api/attempts/${created.body.id}/submissions`)
      .send({ kind: "text", writeup: "class Vehicle has-a ParkingSpot, computes fee based on duration." });

    const retry = await request(app).post(`/api/submissions/${submitted.body.id}/retry`);
    expect(retry.status).toBe(400);
  });
});
