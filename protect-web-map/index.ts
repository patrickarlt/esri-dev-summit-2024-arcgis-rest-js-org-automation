#! /usr/bin/env ts-node
import "dotenv/config";
import { program } from "commander";
import { getItem, getItemData, protectItem } from "@esri/arcgis-rest-portal";
import { ArcGISIdentityManager } from "@esri/arcgis-rest-request";

program.argument("webmap").option("-p, --protect", "Protect items").parse();

const username = process.env.USERNAME;
const password = process.env.PASSWORD;
const webmapItemId = program.args[0];
const protect: boolean = program.opts().protect;

if (!username || !password) {
  throw new Error("Username and password are required");
}

const authentication = await ArcGISIdentityManager.signIn({
  username,
  password,
});

const user = await authentication.getUser();

const webmapItem = await getItem(webmapItemId, { authentication });
const {
  operationalLayers,
  baseMap: { baseMapLayers },
} = await getItemData(webmapItemId, { authentication });

const layersToCheck = [...operationalLayers, ...baseMapLayers];

async function checkItem(itemId: string) {
  const result: any = {
    status: "Unknown",
    message: "N/A",
    title: "Unknown",
    itemId,
    owner: "Unknown",
    error: false,
  };

  try {
    const item = await getItem(itemId, { authentication });

    const isOwner = item.owner === user.username;
    const isOrg = item.orgId === user.orgId;
    const isAuthoritative = item?.contentStatus?.includes("authoritative");
    const isProtected = item.protected;

    result.owner = item.owner;
    result.title = item.title;

    if (!isOwner && !isOrg) {
      result.message = `Item belongs to another organization.`;
      result.status = isAuthoritative
        ? "Authoritative"
        : isProtected
        ? "Protected"
        : "Unknown";
    }

    if (!isOwner && isOrg) {
      result.message = `Item belongs to someone else in your organization.`;
      result.status = isAuthoritative
        ? "Authoritative"
        : isProtected
        ? "Protected"
        : "Unprotected";
    }

    if (isOwner) {
      result.status = isAuthoritative
        ? "Authoritative"
        : isProtected
        ? "Protected"
        : "Unprotected";

      result.message = isProtected
        ? "You own this item."
        : "You can protect this item.";
    }
  } catch (error: any) {
    result.error = true;
    result.message = error?.message;
    result.status = "error";
  }

  return result;
}

const webMapItemDetails = await Promise.all(
  layersToCheck.map(({ itemId }: any) => {
    return checkItem(itemId);
  })
);

const itemsToProtect = webMapItemDetails.filter((item: any) => {
  return item.status === "Unprotected" && item.owner === user.username;
});

const unprotectableItems = webMapItemDetails.filter((item: any) => {
  return item.status === "Unprotected" && item.owner !== user.username;
});

const protectedItems = webMapItemDetails.filter((item: any) => {
  return item.status === "Protected" || item.status === "Authoritative";
});

console.log(
  `\n\nWebmap: ${webmapItem.title} (${webmapItem.id}) - Owner: ${webmapItem.owner}`
);

console.table(webMapItemDetails);

console.log(
  `\n${protectedItems.length}/${webMapItemDetails.length} items are protected.`
);

if (unprotectableItems.length > 0) {
  console.log(`\n\nItems you cannot protect:`);
  console.table(unprotectableItems);
}

if (protect) {
  if (itemsToProtect.length > 0) {
    console.log(`\n\nAttempting to protect:`);
    console.table(itemsToProtect);

    const protectResults = await Promise.all(
      itemsToProtect.map(async ({ itemId }: any) => {
        try {
          const result = await protectItem({ id: itemId, authentication });
          if (result.success) {
            console.log(`\n\nItem ${itemId} protected.`);
          }
          return result;
        } catch (error: any) {
          return {
            itemId,
            error: true,
            message: error.message,
          };
        }
      })
    );
  }
} else {
  console.log(`\n\Items you can protect:`);
  console.table(itemsToProtect);
  console.log(`\nUse the -p flag to protect items`);
}
