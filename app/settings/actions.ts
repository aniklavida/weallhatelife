"use server";

import { revalidatePath } from "next/cache";
import { ProviderConfig, setProviderConfig, clearProviderConfig, dispatchProviderRequest } from "../../lib/provider/dispatch";
import { resolveLifeRoot } from "../../lib/index/runtime";
import { writeEntry } from "../../lib/entry/write";
import { recordTending } from "../../lib/tending/record";

export async function saveProviderKey(data: FormData) {
  const provider = data.get("provider") as ProviderConfig["provider"];
  const apiKey = data.get("apiKey") as string;
  const baseUrl = data.get("baseUrl") as string;

  if (apiKey) {
    setProviderConfig(resolveLifeRoot(), { provider, apiKey, baseUrl });
  } else {
    clearProviderConfig(resolveLifeRoot());
  }

  revalidatePath("/settings");
  revalidatePath("/");
}

export async function clearProviderKey() {
  clearProviderConfig(resolveLifeRoot());
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function testProofOfConcept(prompt: string) {
  const lifeRoot = resolveLifeRoot();
  
  // 1. Dispatch the request
  const response = await dispatchProviderRequest(lifeRoot, { 
    prompt: `The user said: "${prompt}". Reply with a short observation.`
  });
  
  // 2. Write an entry based on it (Proof of Concept)
  const candidate = {
    id: `poc-${Date.now()}`,
    area: "memories",
    kind: "memory",
    title: "Assistant Observation",
    source: "agent:in-site",
    body: response.output
  };
  
  const written = writeEntry(lifeRoot, candidate as never);
  
  // 3. Record tending with a reason
  recordTending(lifeRoot, {
    tool: "in-site-assistant",
    bucket: "filed",
    entryId: written.entry.id,
    summary: "Assistant recorded a thought.",
    reason: "User requested a proof-of-concept write from the in-site assistant."
  });

  revalidatePath("/");
}
