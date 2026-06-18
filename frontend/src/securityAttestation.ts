import { API_BASE, getToken } from "./api";

type CachedAttestation = {
  token: string;
  expiresAt: number;
};

let cached: CachedAttestation | null = null;
let inflight: Promise<string> | null = null;

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const TIMEOUT_MS = 1800;

export async function getRiskAttestation() {
  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000) return cached.token;
  if (inflight) return inflight;
  inflight = createRiskAttestation()
    .catch(() => "")
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function createRiskAttestation() {
  const ips = await collectWebrtcPublicIps();
  const token = getToken();
  if (!token) return "";

  const res = await fetch(`${API_BASE}/api/security/attest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      webrtc_public_ips: ips,
      candidate_types: ips.length ? ["srflx"] : [],
      detected_at: Date.now(),
    }),
  });
  if (!res.ok) return "";
  const data = await res.json().catch(() => null) as { attestation?: string; expires_in?: number } | null;
  if (!data?.attestation) return "";
  cached = {
    token: data.attestation,
    expiresAt: Date.now() + Math.max(60, data.expires_in || 600) * 1000,
  };
  return cached.token;
}

async function collectWebrtcPublicIps() {
  if (typeof RTCPeerConnection === "undefined") return [];
  const found = new Set<string>();
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  try {
    pc.createDataChannel("qf-risk");
    pc.onicecandidate = event => {
      const candidate = event.candidate?.candidate || "";
      const ip = parsePublicIp(candidate);
      if (ip) found.add(ip);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));
  } catch {
    return [];
  } finally {
    pc.close();
  }
  return [...found].slice(0, 5);
}

function parsePublicIp(candidate: string) {
  const match = candidate.match(/(?:^| )((?:\d{1,3}\.){3}\d{1,3})(?: |$)/);
  const ip = match?.[1] || "";
  if (!ip || isPrivateIpv4(ip)) return "";
  return ip;
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || a >= 224;
}
