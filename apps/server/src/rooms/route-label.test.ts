import { expect, test } from "vitest";
import { RoomManager } from "./manager.js";

test("round 2 route label changes while its identifier, movement and archived result remain intact", () => {
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, () => .99);
  try {
    const created = manager.create("s0", "Host"); if (!created.ok) throw new Error(created.error); const code = created.value.room.code;
    for (let i=1;i<4;i++) { const joined=manager.join(`s${i}`,`Persona ${i}`,code); if(!joined.ok)throw new Error(joined.error); }
    manager.start("s0");
    const vote = (optionId:string) => { const v=manager.publicVote(code)!; for(const s of ["s0","s1","s2"])expect(manager.vote(s,{decisionId:v.decisionId,attemptId:v.attemptId,optionId}).ok).toBe(true); };
    vote("abandon"); manager.advanceRound("s0");
    expect(manager.roundTwoView(code)!.routeChoice!.options.find(o=>o.id==="unstable-corridor")).toMatchObject({name:"Pasillo principal",energyCost:20,danger:"HIGH"});
    manager.routeAction("s0","open");vote("unstable-corridor");vote("abandon");manager.openTransport("s0",{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId});
    expect(manager.roundTwoView(code)!.movement).toMatchObject({status:"completed",routeId:"unstable-corridor",routeName:"Pasillo principal",energyCost:20});
    expect(manager.suppliesView(code)!.characters.every(c=>c.energy===55)).toBe(true);
    manager.roundThreeAction("s0","advance");
    expect(manager.roundTwoView(code)!.movement).toMatchObject({routeId:"unstable-corridor",routeName:"Pasillo principal"});
  } finally { manager.dispose(); }
});
