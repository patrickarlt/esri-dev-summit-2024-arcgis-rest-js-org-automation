#! /usr/bin/env ts-node
import "dotenv/config";
import { program } from "commander";
import {
  getItem,
  getItemData,
  protectItem,
  unprotectItem,
  IItem,
} from "@esri/arcgis-rest-portal";
import { ArcGISIdentityManager } from "@esri/arcgis-rest-request";

// setup the commander program to parse the command line options
program
  .argument("webmap")
  .option("-p, --protect", "Protect items")
  .option("-u, --unprotect", "Unprotect items")
  .parse();

const webmapItemId = program.args[0];
const protect: boolean = program.opts().protect;
const unprotect: boolean = program.opts().unprotect;

// load credentials from the .env file, you could also use command line options to set these
const username = process.env.USERNAME;
const password = process.env.PASSWORD;

if (!username || !password) {
  throw new Error("Username and password are required");
}

// create the authentication manager
const authentication = await ArcGISIdentityManager.signIn({
  username,
  password,
});

// get user information for future operations
const user = await authentication.getUser();

// fetch web map and web map data
const webmapItem = await getItem(webmapItemId, { authentication });
const {
  operationalLayers,
  baseMap: { baseMapLayers },
} = await getItemData(webmapItemId, { authentication });

// combine operational and basemap layers to a single array to check
const layersToCheck = [...operationalLayers, ...baseMapLayers];

// check each layer to see if it is protected
const checkResults = await Promise.all(
  layersToCheck.map(({ itemId }: any) => {
    return checkItem(itemId);
  })
);

// check the item to see if it is protected, this varies depending on several factors which are checked below
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
    const isProtected = item.protected;

    result.owner = item.owner;
    result.title = item.title;

    if (!isOwner && !isOrg) {
      result.message = `Item belongs to another organization.`;
      result.status = getProtectionStatus(item);
    }

    if (!isOwner && isOrg) {
      result.message = `Item belongs to someone else in your organization.`;
      result.status = getProtectionStatus(item);
    }

    if (isOwner) {
      result.message = isProtected
        ? "You own this item."
        : "You can protect this item.";

      result.status = getProtectionStatus(item);
    }
  } catch (error: any) {
    result.error = true;
    result.message = error?.message;
    result.status = "error";
  }

  return result;
}

function getProtectionStatus(item: IItem) {
  const isOwner = item.owner === user.username;
  const isOrg = item.orgId === user.orgId;
  const isAuthoritative = item?.contentStatus?.includes("authoritative"); // authoritative items are automatically protected
  const isProtected = item.protected;

  if (isAuthoritative) {
    return "Authoritative";
  }

  if (isProtected && (isOrg || isOwner)) {
    return "Protected";
  }

  if (!isProtected && (isOrg || isOwner)) {
    return "Unprotected";
  }

  return "Unknown";
}

// filter the results to items that can be protected
const itemsToProtect = checkResults.filter((item: any) => {
  return item.status === "Unprotected" && item.owner === user.username;
});

// filter the results to items that cannot be protected
const unprotectableItems = checkResults.filter((item: any) => {
  return item.status === "Unprotected" && item.owner !== user.username;
});

// filter the results to items that are protected
const protectedItems = checkResults.filter((item: any) => {
  return item.status === "Protected" || item.status === "Authoritative";
});

//log the results
console.log(
  `\n\nWebmap: ${webmapItem.title} (${webmapItem.id}) - Owner: ${webmapItem.owner}`
);

console.table(checkResults);

console.log(
  `\n${protectedItems.length}/${checkResults.length} items are protected.`
);

if (unprotectableItems.length > 0) {
  console.log(`\n\nItems you cannot protect:`);
  console.table(unprotectableItems);
}

// if the protect flag is set, attempt to protect the items
if (protect) {
  if (itemsToProtect.length > 0) {
    console.log(`\n\nAttempting to protect ${itemsToProtect.length} item(s)`);
    console.table(itemsToProtect);

    await Promise.all(
      itemsToProtect.map(async ({ itemId, title }: any) => {
        try {
          const result = await protectItem({ id: itemId, authentication });
          if (result.success) {
            console.log(`\n\nItem ${title} (${itemId}) protected.`);
          }
          return result;
        } catch (error: any) {
          console.log(
            `\n\nError protecting ${title} (${itemId}): ${error.message}`
          );
          return {
            itemId,
            error: true,
            message: error.message,
          };
        }
      })
    );
  }

  try {
    console.log("\n\nAttempting to protect webmap");
    await protectItem({ id: webmapItem.id, authentication });
    console.log(`\n\nWebmap ${webmapItem.title} (${webmapItem.id}) protected.`);
  } catch (error: any) {
    console.log(`\n\nError protecting webmap: ${error.message}`);
  }

  process.exit(0);
}

// this is for resetting the demo to un-protect the items
if (unprotect) {
  if (itemsToProtect.length > 0) {
    console.log(
      `\n\nAttempting to un-protect ${itemsToProtect.length} item(s)`
    );
    console.table(itemsToProtect);

    await Promise.all(
      itemsToProtect.map(async ({ itemId, title }: any) => {
        try {
          const result = await unprotectItem({ id: itemId, authentication });
          if (result.success) {
            console.log(`\n\nItem ${title} (${itemId}) un-protected.`);
          }
          return result;
        } catch (error: any) {
          console.log(
            `\n\nError un-protecting ${title} (${itemId}): ${error.message}`
          );
          return {
            itemId,
            error: true,
            message: error.message,
          };
        }
      })
    );
  }

  try {
    console.log("\n\nAttempting to un-protect webmap");
    await unprotectItem({ id: webmapItem.id, authentication });
    console.log(
      `\n\nWebmap ${webmapItem.title} (${webmapItem.id}) un-protected.`
    );
  } catch (error: any) {
    console.log(`\n\nError un-protecting webmap: ${error.message}`);
  }

  process.exit(0);
}

if (itemsToProtect.length > 0) {
  console.log(`\n\Items you can protect:`);
  console.table(itemsToProtect);
  console.log(`Re-run with the -p flag to protect items`);
}
