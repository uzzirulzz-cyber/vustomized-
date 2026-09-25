"use client";

// Voicemail (spec sidebar) — honest capability display.
import { NotConfiguredPanel } from "./shared";

export default function VoicemailView() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <NotConfiguredPanel title="Voicemail is unavailable with the current provider">
        Voicemail recording, transcription and playback are telephony-provider
        capabilities. They activate automatically once a calling provider is
        configured and registered under Settings → Communications → Calling
        Provider. Until then this console refuses to fabricate voicemail rows —
        by design (spec §26: no mock mode in production).
      </NotConfiguredPanel>
    </div>
  );
}
