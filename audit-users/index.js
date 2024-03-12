#! /usr/bin/env node
import "dotenv/config";
import { program } from "commander";
import { searchUsers, getUser } from "@esri/arcgis-rest-portal";
import { ArcGISIdentityManager } from "@esri/arcgis-rest-request";
import Queue from "queue";

// setup the commander program to parse the command line options
program
  .option("-p, --privilege <privilege>", "Privilege to search for")
  .parse();

const privilege = program.opts().privilege;

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

// if we don't have a privilege specified, list the privileges for the current user and exit
if (!privilege) {
  console.log("No privilege specified, your privileges are:");
  user.privileges.forEach((p) => console.log(`  ${p}`));
  process.exit(0);
}

// search for all users
let lastResponse = await searchUsers({
  sortField: "lastlogin",
  authentication,
});

let allUsers = lastResponse.results;

// we can use the nextPage helper to get all the users paging through search results
while (lastResponse.nextPage) {
  lastResponse = await lastResponse.nextPage();
  allUsers = allUsers.concat(lastResponse.results);
}

// since we are going to make a request for each user, we can use a queue to manage the concurrency
const q = new Queue({ results: [], concurrency: 3, timeout: 5000 });

// get each users information and check for the specified privilege
allUsers.forEach((user) => {
  q.push(async () => {
    const { privileges } = await getUser({
      username: user.username,
      authentication,
    });

    const matchingPrivileges = privileges.filter((p) =>
      p.toLowerCase().includes(privilege.toLowerCase())
    );

    return {
      username: user.username,
      privileges: matchingPrivileges,
    };
  });
});

// start running the queue
const results = await q.start();

// format the results and print them to the console
const formatted = results.reduce((acc, result) => {
  const { username, privileges } = result[0];

  if (privileges.length > 0) {
    acc[username] = privileges;
  }
  return acc;
}, {});

if (Object.keys(formatted).length <= 0) {
  console.log("No users found with the specified privilege");
}

Object.keys(formatted).forEach((key) => {
  const username = key;
  const privileges = formatted[key];
  console.log(`\n${username}:`);
  privileges.forEach((privilege) => {
    console.log(`  ${privilege}`);
  });
});
