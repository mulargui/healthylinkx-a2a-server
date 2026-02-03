set -x

# run the a2a server locally in a container
# you can use SearchDoctorsTest to bypass the Healthylinkx catalog and focus on the A2A endpoint
# or install the datastore with deploy.sh and debug end to end

cp config.json ./a2a/src
docker run --rm -w /repo/a2a/src -v $(pwd):/repo node:22 npm install
docker run --rm -w /repo/a2a/src -v $(pwd):/repo \
	-e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ACCOUNT_ID \
	-e AWS_REGION -e AWS_DEFAULT_REGION -e AWS_SESSION_TOKEN \
	-e RUN_LOCAL_HTTP=1 \
	-p 3001:3000 \
	node:22 node index.js
