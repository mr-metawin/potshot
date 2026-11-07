import deployment from './address.json';
export { potShotAbi } from './abi';
export { botTestnet, botMainnet } from './chain';

export const contractAddress = deployment.address as `0x${string}`;
export const deployedRevealWindow = deployment.revealWindow;
export const deploymentTxHash = deployment.txHash;
