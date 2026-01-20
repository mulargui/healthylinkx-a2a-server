set -x

#build and deploy the a2a server (Lambda) in AWS
cp config.json ./a2a/src
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/src -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node deploy-a2a-lambda.js
exit 

#build and deploy the datastore in AWS
docker run --rm -w /repo/datastore/infra -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/datastore/infra -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node DSCreate.js

#build and deploy the a2a server (Lambda) in AWS
cp config.json ./a2a/src
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/src -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node deploy-a2a-lambda.js
exit 

#build documentation (outdated)
docker run --rm -w /repo -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo -v $(pwd):/repo node:22 npm run jsdoc
