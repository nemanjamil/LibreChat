# Qdrant
http://localhost:6333/dashboard#/collections

# Docker exec
docker exec -it qdrant sh
docker-compose up -d --build qdrant
docker-compose up -d --build rag_api

docker logs rag_api
docker logs qdrant

docker network inspect bridge_network

curl -f http://localhost:6333/status
url -f http://localhost:6333/health

