import { describe, it, expect } from "vitest";
import { parseVersion, isNewerVersion, checkForUpdate, RELEASES_URL } from "../update-check";

describe("parseVersion / isNewerVersion", () => {
  it("lê o prefixo v e os três números; lixo devolve null", () => {
    expect(parseVersion("v0.6.0")).toEqual([0, 6, 0]);
    expect(parseVersion("1.2.30")).toEqual([1, 2, 30]);
    expect(parseVersion("latest")).toBeNull();
  });

  it("a comparação é parte a parte, e se alguma não puder ser lida, melhor o silêncio que o alarme falso", () => {
    expect(isNewerVersion("v0.7.0", "0.6.0")).toBe(true);
    expect(isNewerVersion("v0.6.1", "0.6.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("v0.6.0", "0.6.0")).toBe(false);
    expect(isNewerVersion("v0.5.9", "0.6.0")).toBe(false);
    expect(isNewerVersion("lixo", "0.6.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  const okFetch = (tag: string) => async () => ({ ok: true, json: async () => ({ tag_name: tag }) });

  it("há versão nova: hasUpdate=true, apontando a página de releases", async () => {
    const info = await checkForUpdate("0.6.0", okFetch("v0.7.0"));
    expect(info).toEqual({ current: "0.6.0", latest: "0.7.0", hasUpdate: true, url: RELEASES_URL });
  });

  it("já está na mais nova: hasUpdate=false", async () => {
    expect((await checkForUpdate("0.6.0", okFetch("v0.6.0")))?.hasUpdate).toBe(false);
  });

  it("falha de HTTP, erro de rede ou tag ilegível → null (falha em aberto)", async () => {
    expect(await checkForUpdate("0.6.0", async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await checkForUpdate("0.6.0", async () => { throw new Error("offline"); })).toBeNull();
    expect(await checkForUpdate("0.6.0", okFetch("draft"))).toBeNull();
  });
});
