from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status, Request, Form, Response, UploadFile, File
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware  # Добавляем импорт
from typing import List, Dict, Optional
import asyncpg
import json
import logging
from datetime import datetime, timedelta
from jose import JWTError, jwt
from pydantic import BaseModel
import bcrypt
import asyncio
import httpx
from starlette.responses import HTMLResponse
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key="your-session-secret")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

DATABASE_URL = "postgresql://c103470_vkudryavtsev_u6607_ru:exPYuHFoK7JwmOet@postgres.c103470.h2:5432/c103470_vkudryavtsev_u6607_ru"
APP_IP = "127.0.4.102"
APP_PORT = 54949
SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
RECAPTCHA_SECRET_KEY = "6LewhusqAAAAADDx-ca0v0PbSvA5jwUNE-8HvXEG" 

rooms: Dict[str, List[Dict]] = {}
clients: Dict[str, List[WebSocket]] = {}

class User(BaseModel):
    login: str
    full_name: str
    password: str
    role: Optional[str] = "user"

class UserInDB(User):
    hashed_password: str

class Room(BaseModel):
    name: str

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room: str):
        await websocket.accept()
        if room not in self.rooms:
            self.rooms[room] = []
        self.rooms[room].append(websocket)

    def disconnect(self, websocket: WebSocket, room: str):
        if room in self.rooms and websocket in self.rooms[room]:
            self.rooms[room].remove(websocket)
            if not self.rooms[room]:
                del self.rooms[room]

    async def broadcast(self, message: str, room: str):
        if room in self.rooms:
            for connection in self.rooms[room]:
                await connection.send_text(message)

manager = ConnectionManager()

async def init_db():
    conn = await asyncpg.connect(DATABASE_URL)
    await conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            login TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            hashed_password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        );
        CREATE TABLE IF NOT EXISTS rooms (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            room TEXT NOT NULL,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp TIMESTAMP NOT NULL
        );
    ''')
    await conn.execute("INSERT INTO rooms (name) VALUES ('General') ON CONFLICT (name) DO NOTHING")
    try:
        await conn.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS room TEXT NOT NULL DEFAULT 'General'")
    except asyncpg.exceptions.DuplicateColumnError:
        logger.info("Столбец 'room' уже существует")

    try:
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'")
        logger.info("Столбец 'role' добавлен или уже существует")
    except asyncpg.exceptions.DuplicateColumnError:
        logger.info("Столбец 'role' уже существует")

    admin_exists = await conn.fetchrow("SELECT login FROM users WHERE login = 'admin'")
    if not admin_exists:
        hashed_password = hash_password("dohGie5oot0rah8A") 
        await conn.execute(
            "INSERT INTO users (login, full_name, hashed_password, role) VALUES ($1, $2, $3, $4)",
            "admin", "Администратор", hashed_password, "admin"
        )
        logger.info("Создан начальный пользователь 'admin'")
    else:
        await conn.execute("UPDATE users SET role = 'admin' WHERE login = 'admin'")
        logger.info("Роль 'admin' установлена для существующего пользователя 'admin'")

    await conn.execute("UPDATE users SET role = 'user' WHERE role IS NULL AND login != 'admin'")
    await conn.close()

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def verify_recaptcha(recaptcha_response: str) -> bool:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={
                "secret": RECAPTCHA_SECRET_KEY,
                "response": recaptcha_response
            }
        )
        result = response.json()
        logger.info(f"reCAPTCHA response: {result}")
        return result.get("success", False)

async def get_current_user(token: Optional[str] = None, request: Request = None):
    if token is None and request is not None:
        token = (
            request.query_params.get("token") or
            request.headers.get("Authorization", "").replace("Bearer ", "") or
            request.cookies.get("token") 
        )
        logger.info(f"Request URL: {request.url}")
        logger.info(f"Request headers: {request.headers}")
        logger.info(f"Request cookies: {request.cookies}")
        logger.info(f"Extracted token from query: {request.query_params.get('token')}")
        logger.info(f"Extracted token from header: {request.headers.get('Authorization')}")
        logger.info(f"Extracted token from cookie: {request.cookies.get('token')}")
    
    if not token:
        logger.error("Токен отсутствует в запросе")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        login: str = payload.get("sub")
        if login is None:
            logger.error("В токене отсутствует 'sub'")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные",
                headers={"WWW-Authenticate": "Bearer"},
            )
        logger.info(f"Токен декодирован успешно: {login}")
    except JWTError as e:
        logger.error(f"Ошибка декодирования токена: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    conn = await asyncpg.connect(DATABASE_URL)
    user = await conn.fetchrow("SELECT login, full_name, hashed_password, role FROM users WHERE login = $1", login)
    await conn.close()
    
    if user is None:
        logger.error(f"Пользователь не найден: {login}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"login": user["login"], "full_name": user["full_name"], "role": user["role"]}

def admin_required(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Требуются права администратора")
    return current_user

@app.get("/", response_class=HTMLResponse)
async def root():
    return '<meta http-equiv="refresh" content="0;url=/login">'

@app.get("/register", response_class=HTMLResponse)
async def get_register(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})

@app.post("/register")
async def register(user: User, request: Request):
    recaptcha_response = (await request.json()).get("g-recaptcha-response")
    if not recaptcha_response or not await verify_recaptcha(recaptcha_response):
        raise HTTPException(status_code=400, detail="Проверка reCAPTCHA не пройдена")

    conn = await asyncpg.connect(DATABASE_URL)
    existing_user = await conn.fetchrow("SELECT login FROM users WHERE login = $1", user.login)
    if existing_user:
        await conn.close()
        raise HTTPException(status_code=400, detail="Логин уже занят")
    
    hashed_password = hash_password(user.password)
    await conn.execute(
        "INSERT INTO users (login, full_name, hashed_password, role) VALUES ($1, $2, $3, $4)",
        user.login, user.full_name, hashed_password, user.role
    )
    await conn.close()
    return {"message": "Пользователь успешно зарегистрирован"}

@app.get("/login", response_class=HTMLResponse)
async def get_login(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/settings", response_class=HTMLResponse)
async def get_settings(request: Request, current_user: dict = Depends(get_current_user)):
    logger.info(f"Current user in settings: {current_user}")
    return templates.TemplateResponse("settings.html", {"request": request, "current_user": current_user})

@app.post("/settings")
async def update_settings(
    full_name: str = Form(...),
    password: Optional[str] = Form(None),
    avatar: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        updates = {}
        if full_name != current_user["full_name"]:  
            updates["full_name"] = full_name
        if password: 
            hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            updates["hashed_password"] = hashed_password
        if avatar:  
            avatar_dir = "static/avatars"
            os.makedirs(avatar_dir, exist_ok=True)
            avatar_filename = f"{current_user['login']}_{avatar.filename}"
            avatar_path = os.path.join(avatar_dir, avatar_filename)
            with open(avatar_path, "wb") as f:
                f.write(await avatar.read())
            updates["avatar"] = f"/static/avatars/{avatar_filename}"

        if not updates:  
            return {"message": "Изменений не внесено"}

        # Формируем запрос
        query = "UPDATE users SET " + ", ".join(f"{k} = ${i+1}" for i, k in enumerate(updates.keys())) + f" WHERE login = ${len(updates) + 1}"
        values = list(updates.values()) + [current_user["login"]]
        await conn.execute(query, *values)
        
        logger.info(f"User {current_user['login']} updated: {updates}")
        return {"message": "Настройки успешно обновлены"}
    except Exception as e:
        logger.error(f"Error updating user {current_user['login']}: {str(e)}")
        raise HTTPException(status_code=500, detail="Ошибка обновления настроек")
    finally:
        await conn.close()

@app.post("/token")
async def login(request: Request, response: Response):
    data = await request.json()
    username = data.get("username")
    password = data.get("password")
    recaptcha_response = data.get("g-recaptcha-response")
    
    logger.info(f"Login attempt: {username}, reCAPTCHA: {recaptcha_response}")
    if not recaptcha_response or not await verify_recaptcha(recaptcha_response):
        raise HTTPException(status_code=400, detail="Проверка reCAPTCHA не пройдена")

    conn = await asyncpg.connect(DATABASE_URL)
    user = await conn.fetchrow("SELECT * FROM users WHERE login = $1", username)
    await conn.close()
    
    if not user or not verify_password(password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["login"]}, expires_delta=access_token_expires
    )
    response.set_cookie(key="token", value=access_token, max_age=1800, path="/", httponly=False, samesite="lax")
    logger.info(f"Generated token and set cookie: {access_token}")
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/chat", response_class=HTMLResponse)
async def get_chat(request: Request, current_user: dict = Depends(get_current_user)):
    logger.info(f"Current user: {current_user}")
    return templates.TemplateResponse("chat.html", {"request": request, "current_user": current_user})


@app.post("/rooms")
async def create_room(room: Room, current_user: dict = Depends(get_current_user)):
    logger.info(f"Attempting to create room: {room.name} by {current_user['login']}")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("INSERT INTO rooms (name) VALUES ($1)", room.name)
    except asyncpg.exceptions.UniqueViolationError:
        await conn.close()
        raise HTTPException(status_code=400, detail="Комната с таким названием уже существует")
    await conn.close()
    logger.info(f"Room '{room.name}' created successfully")
    return {"message": f"Комната '{room.name}' создана"}

@app.delete("/rooms/{room_name}")
async def delete_room(room_name: str, current_user: dict = Depends(admin_required)):
    logger.info(f"Attempting to delete room: {room_name} by {current_user['login']}")
    conn = await asyncpg.connect(DATABASE_URL)
    result = await conn.execute("DELETE FROM rooms WHERE name = $1", room_name)
    if result == "DELETE 0":
        await conn.close()
        raise HTTPException(status_code=404, detail="Комната не найдена")
    await conn.execute("DELETE FROM messages WHERE room = $1", room_name)
    await conn.close()
    await manager.broadcast(json.dumps({
        "type": "system",
        "message": f"Комната '{room_name}' была удалена"
    }), room_name)
    logger.info(f"Room '{room_name}' deleted successfully")
    return {"message": f"Комната '{room_name}' удалена"}

@app.get("/rooms")
async def get_rooms(current_user: dict = Depends(get_current_user)):
    conn = await asyncpg.connect(DATABASE_URL)
    rows = await conn.fetch("SELECT name FROM rooms")
    await conn.close()
    return {"rooms": [row["name"] for row in rows]}

@app.delete("/messages/{message_id}")
async def delete_message(message_id: int, current_user: dict = Depends(get_current_user)):
    logger.info(f"Attempting to delete message {message_id} by {current_user['login']}")
    conn = await asyncpg.connect(DATABASE_URL)
    message = await conn.fetchrow("SELECT room, username FROM messages WHERE id = $1", message_id)
    if not message:
        await conn.close()
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    if message["username"] != current_user["login"] and current_user["role"] != "admin":
        await conn.close()
        raise HTTPException(status_code=403, detail="Вы можете удалять только свои сообщения")
    await conn.execute("DELETE FROM messages WHERE id = $1", message_id)
    await conn.close()
    await manager.broadcast(json.dumps({
        "type": "delete_message",
        "message_id": message_id
    }), message["room"])
    logger.info(f"Message {message_id} deleted successfully")
    return {"message": f"Сообщение {message_id} удалено"}

@app.post("/users", dependencies=[Depends(admin_required)])
async def add_user(user: User, current_user: dict = Depends(admin_required)):
    conn = await asyncpg.connect(DATABASE_URL)
    existing_user = await conn.fetchrow("SELECT login FROM users WHERE login = $1", user.login)
    if existing_user:
        await conn.close()
        raise HTTPException(status_code=400, detail="Логин уже занят")
    
    hashed_password = hash_password(user.password)
    await conn.execute(
        "INSERT INTO users (login, full_name, hashed_password, role) VALUES ($1, $2, $3, $4)",
        user.login, user.full_name, hashed_password, user.role
    )
    await conn.close()
    logger.info(f"User '{user.login}' added by {current_user['login']}")
    return {"message": f"Пользователь '{user.login}' добавлен"}

@app.delete("/users/{login}", dependencies=[Depends(admin_required)])
async def delete_user(login: str, current_user: dict = Depends(admin_required)):
    if login == "admin":
        raise HTTPException(status_code=403, detail="Нельзя удалить главного администратора")
    conn = await asyncpg.connect(DATABASE_URL)
    result = await conn.execute("DELETE FROM users WHERE login = $1", login)
    if result == "DELETE 0":
        await conn.close()
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    await conn.close()
    logger.info(f"User '{login}' deleted by {current_user['login']}")
    return {"message": f"Пользователь '{login}' удален"}

@app.get("/users", dependencies=[Depends(admin_required)])
async def get_users(current_user: dict = Depends(admin_required)):
    conn = await asyncpg.connect(DATABASE_URL)
    rows = await conn.fetch("SELECT login, full_name, role FROM users")
    await conn.close()
    return {"users": [{"login": row["login"], "full_name": row["full_name"], "role": row["role"]} for row in rows]}

async def save_message(room: str, username: str, message: str) -> int:
    conn = await asyncpg.connect(DATABASE_URL)
    timestamp = datetime.now()
    message_id = await conn.fetchval(
        "INSERT INTO messages (room, username, message, timestamp) VALUES ($1, $2, $3, $4) RETURNING id",
        room, username, message, timestamp
    )
    await conn.close()
    return message_id

async def get_recent_messages(room: str, limit: int = 50) -> List[Dict]:
    conn = await asyncpg.connect(DATABASE_URL)
    rows = await conn.fetch(
        "SELECT id, username, message, timestamp FROM messages WHERE room = $1 ORDER BY id DESC LIMIT $2",
        room, limit
    )
    await conn.close()
    messages = [{'id': row['id'], 'username': row['username'], 
                'message': row['message'], 'timestamp': row['timestamp'].isoformat()} 
               for row in rows]
    return messages[::-1]

async def broadcast(room: str, message: dict):
    if room in clients:
        logger.info(f"Broadcasting to room '{room}' with {len(clients[room])} clients: {message}")
        for client in clients[room][:]:  
            try:
                await client.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Error sending message to client in room '{room}': {str(e)}")
                if client in clients[room]:  
                    clients[room].remove(client)
                logger.info(f"Removed disconnected client from room '{room}'. Remaining clients: {len(clients[room])}")
    else:
        logger.warning(f"No clients in room '{room}' to broadcast to")

async def broadcast_system(room: str, message: str):
    await broadcast(room, {"type": "system", "message": message})

@app.websocket("/ws/{room}/{username}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str, token: str = None):
    current_user = await get_current_user(token=token)
    await websocket.accept()
    if room not in rooms:
        rooms[room] = []
    clients.setdefault(room, []).append(websocket)
    logger.info(f"User '{username}' connected to room '{room}'. Clients in room: {len(clients[room])}")
    try:
        await broadcast_system(room, f"{username} присоединился к чату")
        
        conn = await asyncpg.connect(DATABASE_URL)
        messages = await conn.fetch("SELECT id, username, message, timestamp FROM messages WHERE room = $1 ORDER BY timestamp", room)
        await websocket.send_text(json.dumps({
            "type": "history",
            "messages": [
                {
                    "id": m["id"],
                    "username": m["username"],
                    "full_name": (await conn.fetchval("SELECT full_name FROM users WHERE login = $1", m["username"])) or m["username"],
                    "message": m["message"],
                    "timestamp": m["timestamp"].isoformat(),
                    "avatar": (await conn.fetchval("SELECT avatar FROM users WHERE login = $1", m["username"])) or "/static/avatars/default.png"
                } for m in messages
            ]
        }))
        await conn.close()
        
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            message = message_data["message"]
            conn = await asyncpg.connect(DATABASE_URL)
            timestamp = datetime.utcnow()
            message_id = await conn.fetchval(
                "INSERT INTO messages (room, username, message, timestamp) VALUES ($1, $2, $3, $4) RETURNING id",
                room, username, message, timestamp
            )
            user_full_name = await conn.fetchval("SELECT full_name FROM users WHERE login = $1", username) or username
            user_avatar = await conn.fetchval("SELECT avatar FROM users WHERE login = $1", username) or "/static/avatars/default.png"
            await conn.close()
            await broadcast(room, {
                "type": "message",
                "id": message_id,
                "username": username,
                "full_name": user_full_name,
                "message": message,
                "timestamp": timestamp.isoformat(),
                "avatar": user_avatar
            })
    except WebSocketDisconnect:
        if room in clients and websocket in clients[room]:
            clients[room].remove(websocket)
            logger.info(f"User '{username}' disconnected from room '{room}'. Clients in room: {len(clients[room])}")
            await broadcast_system(room, f"{username} покинул чат")
            if not clients[room]:
                del clients[room]
                logger.info(f"Room '{room}' is now empty and removed from clients")
    except Exception as e:
        logger.error(f"WebSocket error for user '{username}' in room '{room}': {str(e)}")
        if room in clients and websocket in clients[room]:
            clients[room].remove(websocket)
        await websocket.close()

@app.on_event("startup")
async def startup():
    await init_db()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=APP_IP, port=APP_PORT)
