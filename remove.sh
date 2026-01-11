set -x

#remove the datastore from AWS
docker run --rm -w /repo/datastore/infra -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/datastore/infra -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node DSDelete.js

#remove the a2a server (Lambda) from AWS
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/infra -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
    node:22 node delete-a2a-lambda.js
