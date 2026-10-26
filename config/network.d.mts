export interface NetworkConfig {
  mode: 'local' | 'lan'; frontendHost: string; frontendPort: number;
  backendHost: string; backendPort: number; backendUrl: string; webOrigin: string; webOrigins: string[];
}
export function readNetworkConfig(env: Readonly<Record<string, string | undefined>>): NetworkConfig;
