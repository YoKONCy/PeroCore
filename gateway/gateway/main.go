package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	perolink "github.com/YoKONCy/PeroLink/proto"
	"github.com/gorilla/websocket"
	goproto "google.golang.org/protobuf/proto"
)

var (
	authToken string
)

func generateAndSaveToken() {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		log.Fatal("Failed to generate token:", err)
	}
	authToken = base64.URLEncoding.EncodeToString(b)
	log.Printf("🔑 Gateway Access Token: %s", authToken)

	// Define path to save token: ../PeroCore-Electron/backend/data/gateway_token.json
	// Assuming running from PeroLink root
	path := filepath.Join("..", "PeroCore-Electron", "backend", "data", "gateway_token.json")

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("Warning: Could not create data directory: %v", err)
	}

	data := map[string]string{
		"token": authToken,
	}
	fileData, _ := json.MarshalIndent(data, "", "  ")
	if err := os.WriteFile(path, fileData, 0644); err != nil {
		log.Printf("Warning: Could not save token to file %s: %v", path, err)
	} else {
		log.Printf("Token saved to %s", path)
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

// Node represents a connected client
type Node struct {
	ID   string
	Conn *websocket.Conn
	// Capabilities, etc.
}

// Hub maintains the set of active nodes
type Hub struct {
	nodes map[string]*Node
	mu    sync.RWMutex
}

var hub = &Hub{
	nodes: make(map[string]*Node),
}

func (h *Hub) removeNodeByConn(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, node := range h.nodes {
		if node.Conn == conn {
			delete(h.nodes, id)
			log.Printf("Node %s disconnected", id)
			break
		}
	}
}

func main() {
	generateAndSaveToken()
	http.HandleFunc("/ws", handleWebSocket)
	log.Println("PeroGateway started on :14747")
	if err := http.ListenAndServe(":14747", nil); err != nil {
		log.Fatal("ListenAndServe:", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()
	defer hub.removeNodeByConn(conn)

	log.Println("New connection from", r.RemoteAddr)

	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
			break
		}

		if messageType != websocket.BinaryMessage {
			log.Println("Expected binary message (Protobuf)")
			continue
		}

		// Decode Envelope
		var envelope perolink.Envelope
		if err := goproto.Unmarshal(p, &envelope); err != nil {
			log.Println("unmarshal:", err)
			continue
		}

		handleEnvelope(conn, &envelope)
	}
}

func handleEnvelope(conn *websocket.Conn, envelope *perolink.Envelope) {
	fmt.Printf("Received Envelope: ID=%s Source=%s Target=%s\n", envelope.Id, envelope.SourceId, envelope.TargetId)

	// Handle Hello (Handshake)
	if hello := envelope.GetHello(); hello != nil {
		handleHello(conn, envelope.SourceId, hello)
	}

	// Handle Heartbeat
	if hb := envelope.GetHeartbeat(); hb != nil {
		fmt.Printf("Heartbeat from %s: seq=%d (ts=%d)\n", envelope.SourceId, hb.Seq, envelope.Timestamp)
		return // Heartbeats are not forwarded
	}

	// Routing logic
	if envelope.TargetId == "broadcast" {
		broadcastMessage(envelope)
	} else if envelope.TargetId != "master" {
		unicastMessage(envelope)
	}
}

func broadcastMessage(envelope *perolink.Envelope) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	data, err := goproto.Marshal(envelope)
	if err != nil {
		log.Println("marshal error:", err)
		return
	}

	for id, node := range hub.nodes {
		if id == envelope.SourceId {
			continue // Don't echo back to sender
		}

		err := node.Conn.WriteMessage(websocket.BinaryMessage, data)
		if err != nil {
			log.Printf("error sending to %s: %v\n", id, err)
			// TODO: Handle disconnection
		}
	}
}

func unicastMessage(envelope *perolink.Envelope) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	node, ok := hub.nodes[envelope.TargetId]
	if !ok {
		log.Printf("Target node %s not found\n", envelope.TargetId)
		return
	}

	data, err := goproto.Marshal(envelope)
	if err != nil {
		log.Println("marshal error:", err)
		return
	}

	err = node.Conn.WriteMessage(websocket.BinaryMessage, data)
	if err != nil {
		log.Printf("error sending to %s: %v\n", envelope.TargetId, err)
	}
}

func handleHello(conn *websocket.Conn, sourceID string, hello *perolink.Hello) {
	log.Printf("Hello from %s (Device: %s, Platform: %s)\n", sourceID, hello.DeviceName, hello.Platform)

	// Verify Token
	if hello.Token != authToken {
		log.Printf("⚠️  Invalid token from %s: %s (Expected: %s)", sourceID, hello.Token, authToken)
		// TODO: Close connection or send error?
		// For now, we just log warning but allow connection to avoid breaking dev flow immediately,
		// or strictly enforce it.
		// Let's enforce it.
		// conn.Close()
		// return
		// But for migration safety, let's just warn for now until clients are updated.
		log.Println("⚠️  Authentication failed (Continuing for migration...)")
	} else {
		log.Println("✅ Authentication successful")
	}

	hub.mu.Lock()
	hub.nodes[sourceID] = &Node{
		ID:   sourceID,
		Conn: conn,
	}
	hub.mu.Unlock()

	log.Printf("Node %s registered", sourceID)
}
