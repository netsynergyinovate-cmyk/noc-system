FROM golang:alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server ./cmd/server

FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/server /app/server
EXPOSE 8080 2055/udp 514/udp
ENTRYPOINT ["/app/server"]
