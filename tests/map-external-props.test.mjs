import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const loaderPath = path.resolve(
  __dirname,
  "../src/components/map/network-map-leaflet-loader.tsx",
);

test("Ubah penanda peta jadi prop data eksternal", async (t) => {
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const loaderContent = fs.readFileSync(loaderPath, "utf8");

  await t.test(
    "verifies NetworkMapProps exports external data and marker props",
    () => {
      assert.match(
        mapContent,
        /export interface NetworkMapProps/,
        "NetworkMapProps must be exported",
      );
      assert.match(
        mapContent,
        /data\?: NetworkMapData;/,
        "Must support external 'data' prop",
      );
      assert.match(
        mapContent,
        /customers\?: NetworkCustomerPoint\[\];/,
        "Must support external 'customers' marker prop",
      );
      assert.match(
        mapContent,
        /infrastructure\?: NetworkInfrastructurePoint\[\];/,
        "Must support external 'infrastructure' marker prop",
      );
      assert.match(
        mapContent,
        /onSelectCustomer\?: \(customer: NetworkCustomerPoint \| null\) => void;/,
        "Must support external onSelectCustomer callback",
      );
      assert.match(
        mapContent,
        /onSelectInfrastructure\?: \(infra: NetworkInfrastructurePoint \| null\) => void;/,
        "Must support external onSelectInfrastructure callback",
      );
    },
  );

  await t.test(
    "verifies NetworkMap syncs internal state with external marker props",
    () => {
      assert.match(
        mapContent,
        /if \(propData\)/,
        "Must sync when external propData changes",
      );
      assert.match(
        mapContent,
        /if \(propCustomers \|\| propInfra\)/,
        "Must sync when external propCustomers or propInfra change",
      );
      assert.match(
        mapContent,
        /onSelectCustomer\?\.\(cust\)/,
        "Must invoke onSelectCustomer when marker is clicked",
      );
      assert.match(
        mapContent,
        /onSelectInfrastructure\?\.\(infra\)/,
        "Must invoke onSelectInfrastructure when infra marker is clicked",
      );
    },
  );

  await t.test(
    "verifies NetworkMapLeafletLoader forwards all external props",
    () => {
      assert.match(
        loaderContent,
        /export type NetworkMapLoaderProps = NetworkMapProps;/,
        "Loader must accept all external NetworkMapProps and pass them through",
      );
      assert.match(
        loaderContent,
        /<DynamicNetworkMap \{\.\.\.props\} \/>/,
        "Loader must forward props to DynamicNetworkMap",
      );
    },
  );
});
