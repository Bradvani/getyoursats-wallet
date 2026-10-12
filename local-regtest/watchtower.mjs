#!/usr/bin/env node
/**
 * The scenarios in which somebody else exits a leaf's parent, against the
 * cluster already running.
 *
 *   node local-regtest/watchtower.mjs leaf [sats] [renewals] [phrase or spark address]
 *   node local-regtest/watchtower.mjs parent [leaf id]
 *   node local-regtest/watchtower.mjs exit [leaf id]
 *
 * `leaf` has two cluster wallets renew a leaf, so that it has split nodes above
 * it, and sends it to the wallet. `parent` confirms the root of the leaf's tree,
 * after which the operators mark the leaf PARENT_EXITED. `exit` mines until the
 * operators' watchtower has cut off everything below the next split node, which
 * the operators mark WATCHTOWER_EXITED. It does what `parent` does first when
 * nobody has yet. Both take the leaf made last unless you name one.
 */
const base = process.env.FUND_URL ?? 'http://127.0.0.1:8997';

const die = msg => {
  console.error(msg);
  process.exit(1);
};

async function ask(path, query) {
  let response;
  try {
    response = await fetch(`${base}${path}?${new URLSearchParams(query)}`, {
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch {
    die(`No cluster answering at ${base}. Start it first: npm run regtest:up`);
  }
  const body = await response.json();
  if (body.error) die(body.error);
  return body;
}

const printNodes = report => {
  console.log('nodes, root first:');
  for (const node of report.nodes) console.log(`  ${node.id}  ${node.status}`);
  console.log(`Leaf ${report.leaf} is ${report.status}.`);
};

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'leaf': {
    const [sats = '200000', renewals = '2', wallet] = args;
    const query = { sats, renewals };
    // A phrase has spaces and a Spark address has none.
    if (wallet) query[wallet.includes(' ') ? 'mnemonic' : 'address'] = wallet;

    console.log(`Renewing a ${sats} sat leaf ${renewals} time(s)...`);
    const { leaf } = await ask('/renewed-leaf', query);
    console.log(`Sent leaf ${leaf} to the wallet.`);
    console.log('Open the app and wait for the balance, then run: npm run regtest:parent-exit');
    break;
  }
  case 'parent': {
    const [leaf] = args;
    console.log('Confirming the root...');
    const report = await ask('/parent-exit', leaf ? { leaf } : {});
    console.log(`root transaction  ${report.rootTxid}`);
    printNodes(report);
    console.log(
      `The watchtower steps in once ${report.watchtowerTimelock} more blocks are mined: npm run regtest:watchtower-exit`,
    );
    break;
  }
  case 'exit': {
    const [leaf] = args;
    console.log("Mining past the watchtower's timelock...");
    const report = await ask('/watchtower-exit', leaf ? { leaf } : {});
    console.log(`root transaction        ${report.rootTxid}`);
    console.log(`watchtower transaction  ${report.watchtowerTxid}`);
    printNodes(report);
    break;
  }
  default:
    die('usage: leaf [sats] [renewals] [phrase or spark address] | parent [leaf id] | exit [leaf id]');
}
