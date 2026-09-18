import { getProviderConfig } from "../../lib/provider/dispatch";
import { resolveLifeRoot } from "../../lib/index/runtime";
import { saveProviderKey, clearProviderKey, testProofOfConcept } from "./actions";

export default async function SettingsPage() {
  const config = getProviderConfig(resolveLifeRoot());
  
  return (
    <main style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Settings</h1>
      
      <section style={{ marginTop: '2rem' }}>
        <h2>In-site Assistant Provider</h2>
        <p>
          Configure an AI provider to enable the built-in assistant.
          <strong> Note: The server makes no outbound network calls unless this is configured, and then only to the provider chosen.</strong>
        </p>
        
        <form action={saveProviderKey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          <label>
            Provider:<br/>
            <select name="provider" defaultValue={config?.provider || "custom"}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            API Key:<br/>
            <input type="password" name="apiKey" defaultValue={config?.apiKey || ""} required />
          </label>
          <label>
            Base URL (Optional, defaults apply if empty):<br/>
            <input type="text" name="baseUrl" defaultValue={config?.baseUrl || ""} />
          </label>
          <div>
            <button type="submit">Save Key</button>
          </div>
        </form>

        {config && (
          <form action={clearProviderKey} style={{ marginTop: '1rem' }}>
            <button type="submit" style={{ color: 'red' }}>Disable In-site Assistant (Clear Key)</button>
          </form>
        )}
      </section>
      
      {config && (
        <section style={{ marginTop: '2rem' }}>
          <h2>Proof of Concept</h2>
          <form action={async (formData: FormData) => {
            "use server";
            await testProofOfConcept(formData.get("prompt") as string);
          }}>
            <input type="text" name="prompt" placeholder="Say something to the assistant..." required />
            <button type="submit">Send & Write</button>
          </form>
        </section>
      )}
    </main>
  );
}
