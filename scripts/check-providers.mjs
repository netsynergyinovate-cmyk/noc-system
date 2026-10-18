import { getTileProviders } from '../src/config/map.ts';

const providers = getTileProviders();
console.log("Providers:", JSON.stringify(providers, null, 2));

