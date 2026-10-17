"""Loopback-only WS peer for the JVM production-core tests; never accepts production credentials."""
import base64
import hashlib
import socket
import struct
import threading
import time


class LocalASRPeer:
    MODES = ["normal", "slow", "refused", "disconnect", "cancel", "redirect", "throwing", "after-throwing"]

    def __enter__(self):
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(8)
        self.server.settimeout(15)
        self.url = "ws://127.0.0.1:%d" % self.server.getsockname()[1]
        self.errors, self.workers = [], []
        self.requests = self.bytes = self.frames = self.lasts = 0
        self.thread = threading.Thread(target=self.accept, daemon=True)
        self.thread.start()
        return self

    def accept(self):
        try:
            for mode in self.MODES:
                conn, _ = self.server.accept()
                self.requests += 1
                worker = threading.Thread(target=self.peer, args=(conn, mode), daemon=True)
                self.workers.append(worker)
                worker.start()
            self.server.settimeout(.5)
            try:
                extra, _ = self.server.accept()
                extra.close()
                self.errors.append("unexpected retry/redirect connection")
            except socket.timeout:
                pass
        except Exception as error:
            self.errors.append(type(error).__name__)

    @staticmethod
    def read(conn, count):
        result = bytearray()
        while len(result) < count:
            part = conn.recv(min(65536, count - len(result)))
            if not part:
                raise EOFError()
            result.extend(part)
        return bytes(result)

    def frame(self, conn):
        header = self.read(conn, 2)
        opcode, size = header[0] & 15, header[1] & 127
        assert header[1] & 128
        if size == 126:
            size = struct.unpack("!H", self.read(conn, 2))[0]
        elif size == 127:
            size = struct.unpack("!Q", self.read(conn, 8))[0]
        mask = self.read(conn, 4)
        if size > 6420:  # Discard synthetic backlog without retaining its 8 MiB payload.
            remaining = size
            while remaining:
                remaining -= len(self.read(conn, min(65536, remaining)))
            return opcode, b""
        data = self.read(conn, size)
        return opcode, bytes(value ^ mask[i % 4] for i, value in enumerate(data))

    def peer(self, conn, mode):
        try:
            conn.settimeout(5)
            header = bytearray()
            while not header.endswith(b"\r\n\r\n"):
                header.extend(self.read(conn, 1))
                assert len(header) <= 8192
            # Only this deliberately synthetic token may ever reach the stub.
            assert b"authorization: bearer synthetic-only" in header.lower()
            assert header.startswith(b"GET /v1/asr/transcriptions ")
            if mode == "redirect":
                conn.sendall(("HTTP/1.1 302 Found\r\nLocation: " + self.url.replace("ws:", "http:") + "/must-not-follow\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").encode())
                return
            key = next(line.split(b":", 1)[1].strip() for line in header.split(b"\r\n") if line.lower().startswith(b"sec-websocket-key:"))
            accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
            if mode in ("refused", "disconnect", "cancel", "throwing", "after-throwing"):
                time.sleep(.8 if mode == "throwing" else .2 if mode != "disconnect" else .05)
                if mode == "cancel":
                    try:
                        conn.sendall(b'\x81\x02{}')
                    except OSError:
                        pass
                return
            if mode == "slow":
                time.sleep(.8)
            sequence = 0
            while True:
                opcode, data = self.frame(conn)
                if opcode == 8:
                    return
                if opcode == 1:
                    assert b"frozen-synthetic" in data
                if opcode == 2 and data:
                    assert data[:4] == b"VLA2"
                    seq, _, size = struct.unpack_from("<III", data, 8)
                    assert seq == sequence and size == len(data) - 20
                    sequence += 1
                    if mode == "normal":
                        self.bytes += size; self.frames += 1
                        self.lasts += bool(data[6] & 2)
                        if data[6] & 2:
                            assert self.bytes == 6402 and self.frames == 2 and self.lasts == 1
                            time.sleep(.3)
                            final = b'{"type":"asr.final","text":"synthetic"}'
                            conn.sendall(bytes([129, len(final)]) + final)
                            conn.sendall(b'\x88\x02' + struct.pack('!H', 1000))
        except (EOFError, ConnectionResetError, BrokenPipeError):
            pass
        except Exception as error:
            self.errors.append(mode + ":" + type(error).__name__)
        finally:
            conn.close()

    def __exit__(self, *_):
        self.thread.join(2)
        self.server.close()
        for worker in self.workers:
            worker.join(1)
        if not self.errors and self.requests == len(self.MODES) and self.bytes == 6402 and self.frames == 2 and self.lasts == 1:
            print("PASS loopback peer: requests=8 (no retry/redirect), PCM=6402 frames=2 LAST=1, synthetic credentials only")
        else:
            raise AssertionError({"errors": self.errors, "requests": self.requests, "bytes": self.bytes, "frames": self.frames, "lasts": self.lasts})
