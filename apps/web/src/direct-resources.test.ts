import { expect, test, vi } from "vitest";
import type { PackInput, TreatmentInput } from "@everest/shared";
import { DirectResourceRequest } from "./direct-resources";
function storage() { const values=new Map<string,string>(); return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}}; }
const valid=(v:unknown):v is PackInput=>!!v&&typeof v==="object"&&typeof (v as PackInput).requestId==="string"&&typeof (v as PackInput).targetParticipantId==="string"&&typeof (v as PackInput).windowId==="string";
const pack:PackInput={requestId:"one",windowId:"prep",targetParticipantId:"other"};
test("direct pack targets the clicked card and refuses concurrent duplicate clicks",()=>{
 const request=new DirectResourceRequest("pack",valid,storage());const send=vi.fn();
 expect(request.begin(pack,"snapshot",send,()=>{})).toBe(true);
 expect(request.begin({...pack,requestId:"two",targetParticipantId:"self"},"snapshot",send,()=>{})).toBe(false);
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]![0]).toEqual(pack);
});
test("confirmed pack waits for a server snapshot before a new intentional dose",()=>{
 const request=new DirectResourceRequest("pack",valid,storage());const send=vi.fn();request.begin(pack,"old",send,()=>{});
 send.mock.calls[0]![1]({ok:true});expect(request.blocked("old")).toBe(true);expect(request.blocked("updated")).toBe(false);
 expect(request.begin({...pack,requestId:"two"},"updated",send,()=>{})).toBe(true);expect(send).toHaveBeenCalledTimes(2);
});
test("F5 and missing acknowledgement replay the same receipt, destination and window",()=>{
 const saved=storage();const first=new DirectResourceRequest("pack",valid,saved);const send=vi.fn();first.begin(pack,"old",send,()=>{});send.mock.calls[0]![1](null);
 expect(first.pending).toEqual(pack);const restored=new DirectResourceRequest("pack",valid,saved);restored.retry("new",send,()=>{});
 expect(send.mock.calls[1]![0]).toEqual(pack);send.mock.calls[1]![1]({ok:true});expect(saved.getItem("pack")).toBeNull();expect(restored.pending).toBeNull();
});
test("direct medical action retains the clicked patient, round and game",()=>{
 const saved=storage();const validMedical=(v:unknown):v is TreatmentInput=>!!v&&typeof v==="object"&&typeof (v as TreatmentInput).gameId==="string";
 const request=new DirectResourceRequest("medical",validMedical,saved);const send=vi.fn();const input:TreatmentInput={requestId:"t",targetParticipantId:"medic-self",gameId:"game",round:5};
 request.begin(input,"s",send,()=>{});expect(send.mock.calls[0]![0]).toEqual(input);
 const restored=new DirectResourceRequest("medical",validMedical,saved);restored.retry("s",send,()=>{});expect(send.mock.calls[1]![0]).toEqual(input);
});
test("a rejected resource explains the reason and does not retain a pending request",()=>{
 const saved=storage();const request=new DirectResourceRequest("pack",valid,saved);const send=vi.fn();request.begin(pack,"s",send,()=>{});send.mock.calls[0]![1]({ok:false,error:"energy-full"});
 expect(request.pending).toBeNull();expect(saved.getItem("pack")).toBeNull();expect(request.message).toContain("energía completa");
});
test("storage failure prevents unsafe nonrecoverable administration",()=>{
 const send=vi.fn();const request=new DirectResourceRequest("pack",valid,null);expect(request.begin(pack,"s",send,()=>{})).toBe(false);expect(send).not.toHaveBeenCalled();
});
