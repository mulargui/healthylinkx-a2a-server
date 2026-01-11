import A2ADeployer from './A2ADeployer.js';

async function main() {
  const deployer = new A2ADeployer();
  try {
    await deployer.deployLambda();
  } catch (error) {
    console.error('A2A Deployment failed:', error);
    process.exit(1);
  }
}

main();
