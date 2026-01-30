import asyncio
import logging
import time
import uuid
import platform
import websockets
from proto import perolink_pb2

logger = logging.getLogger(__name__)

class GatewayClient:
    def __init__(self, uri="ws://localhost:14747/ws"):
        self.uri = uri
        self.websocket = None
        self.running = False
        self.device_id = f"python-backend-{str(uuid.uuid4())[:8]}"
        self.heartbeat_task = None
        self.token = "python-token" # Default, will be overwritten
        self.listeners = {} # event_name -> [callback]

    def set_token(self, token):
        self.token = token

    def on(self, event_name, callback):
        """Register an event listener.
        Events: 'request', 'action:{name}', 'stream', 'connect', 'disconnect'
        """
        if event_name not in self.listeners:
            self.listeners[event_name] = []
        self.listeners[event_name].append(callback)

    def emit(self, event_name, *args, **kwargs):
        """Emit an event to listeners."""
        if event_name in self.listeners:
            for callback in self.listeners[event_name]:
                if asyncio.iscoroutinefunction(callback):
                    asyncio.create_task(callback(*args, **kwargs))
                else:
                    try:
                        callback(*args, **kwargs)
                    except Exception as e:
                        logger.error(f"Error in listener for {event_name}: {e}")

    async def start(self):
        self.running = True
        # Run in background loop to avoid blocking startup if connection fails immediately
        while self.running:
            try:
                logger.info(f"Connecting to Gateway at {self.uri}...")
                async with websockets.connect(self.uri) as websocket:
                    self.websocket = websocket
                    logger.info("Connected to Gateway")
                    
                    await self.send_hello()
                    await self.send_test_broadcast()
                    
                    # Start heartbeat loop
                    self.heartbeat_task = asyncio.create_task(self.heartbeat_loop())
                    
                    # Listen for messages
                    await self.listen()
            except Exception as e:
                logger.error(f"Gateway connection error: {e}")
                if self.heartbeat_task:
                    self.heartbeat_task.cancel()
                self.websocket = None
                await asyncio.sleep(3)  # Reconnect delay

    def start_background(self):
        asyncio.create_task(self.start())

    async def stop(self):
        self.running = False
        if self.websocket:
            await self.websocket.close()
        if self.heartbeat_task:
            self.heartbeat_task.cancel()

    async def listen(self):
        try:
            async for message in self.websocket:
                if isinstance(message, bytes):
                    envelope = perolink_pb2.Envelope()
                    envelope.ParseFromString(message)
                    await self.handle_envelope(envelope)
        except websockets.ConnectionClosed:
            logger.warning("Gateway connection closed")

    async def send_hello(self):
        envelope = perolink_pb2.Envelope()
        envelope.id = str(uuid.uuid4())
        envelope.source_id = self.device_id
        envelope.target_id = "master"
        envelope.timestamp = int(time.time() * 1000)
        
        envelope.hello.token = self.token
        envelope.hello.device_name = "PeroCore Backend"
        envelope.hello.client_version = "1.0.0"
        envelope.hello.platform = platform.system().lower()
        
        await self.send(envelope)

    async def send_test_broadcast(self):
        envelope = perolink_pb2.Envelope()
        envelope.id = str(uuid.uuid4())
        envelope.source_id = self.device_id
        envelope.target_id = "broadcast"
        envelope.timestamp = int(time.time() * 1000)
        envelope.trace_id = "TEST-BROADCAST"
        envelope.request.action_name = "ping"
        
        logger.info(f"Sending broadcast ping from {self.device_id}")
        await self.send(envelope)

    async def broadcast_pet_state(self, state_dict: dict):
        """Broadcast PetState update to all clients."""
        if not self.websocket or not self.running:
            return

        try:
            envelope = perolink_pb2.Envelope()
            envelope.id = str(uuid.uuid4())
            envelope.source_id = self.device_id
            envelope.target_id = "broadcast"
            envelope.timestamp = int(time.time() * 1000)
            
            envelope.request.action_name = "state_update"
            
            # Convert all values to string for protobuf map
            for k, v in state_dict.items():
                if v is not None:
                    envelope.request.params[k] = str(v)
            
            await self.send(envelope)
            logger.info(f"Broadcasted PetState update: {state_dict.get('mood')}")
        except Exception as e:
            logger.error(f"Failed to broadcast PetState: {e}")

    async def heartbeat_loop(self):
        seq = 0
        while self.running:
            try:
                await asyncio.sleep(5)
                seq += 1
                envelope = perolink_pb2.Envelope()
                envelope.id = str(uuid.uuid4())
                envelope.source_id = self.device_id
                envelope.target_id = "master"
                envelope.timestamp = int(time.time() * 1000)
                envelope.heartbeat.seq = seq
                
                await self.send(envelope)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat error: {e}")
                break

    async def send(self, envelope):
        if self.websocket:
            data = envelope.SerializeToString()
            await self.websocket.send(data)

    async def handle_envelope(self, envelope):
        logger.info(f"Received Envelope: {envelope.id} from {envelope.source_id}")
        
        if envelope.HasField("request"):
            await self.handle_request(envelope)
        elif envelope.HasField("stream"):
            self.emit("stream", envelope)
        elif envelope.HasField("response"):
            self.emit("response", envelope)

    async def handle_request(self, envelope):
        req = envelope.request
        logger.info(f"Handling request: {req.action_name} params={req.params}")
        
        # Emit generic request event
        self.emit("request", envelope)
        # Emit specific action event
        self.emit(f"action:{req.action_name}", envelope)
        
        # Default handlers for basic diagnostics
        resp_envelope = perolink_pb2.Envelope()
        resp_envelope.id = str(uuid.uuid4())
        resp_envelope.source_id = self.device_id
        resp_envelope.target_id = envelope.source_id # Reply to sender
        resp_envelope.timestamp = int(time.time() * 1000)
        resp_envelope.trace_id = envelope.trace_id
        
        if req.action_name == "ping":
            resp_envelope.response.request_id = envelope.id
            resp_envelope.response.status = 0
            resp_envelope.response.data = "Pong from Python!"
            await self.send(resp_envelope)
        elif req.action_name == "echo":
            resp_envelope.response.request_id = envelope.id
            resp_envelope.response.status = 0
            resp_envelope.response.data = f"Echo: {req.params.get('text', '')}"
            await self.send(resp_envelope)
        # Removed hardcoded 'chat' handler to delegate to RealtimeSessionManager via event listener


gateway_client = GatewayClient()
