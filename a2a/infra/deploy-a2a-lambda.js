import LambdaDeployer from './LambdaDeployer.js';

async function main() {
  const deployer = new LambdaDeployer();

  try {
    await deployer.deployLambda();
  } catch (error) {
    console.error('A2A Deployment failed:', error);
  }
}

main();
