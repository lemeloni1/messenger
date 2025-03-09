(function() {
    let ws = null;
    const urlParams = new URLSearchParams(window.location.search);
    let token = document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1] || urlParams.get("token");
    const username = localStorage.getItem("username");

    if (typeof window.currentUserRole === "undefined") {
        console.error("currentUserRole is not defined yet!");
        setTimeout(function() { window.location.reload(); }, 100);
        return;
    }

    let currentRoom = "General";

    console.log("Initial token from cookie:", document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1]);
    console.log("Initial token from URL:", urlParams.get("token"));
    console.log("Initial username from localStorage:", localStorage.getItem("username"));
    console.log("Current user role from window:", window.currentUserRole);

    if (!token || !username) {
        console.error("Token or username missing, redirecting to login");
        console.log("Token at check:", token);
        console.log("Username at check:", username);
        window.location.href = "/login";
    } else {
        console.log("Token:", token);
        console.log("Username:", username);
        loadRooms();
        updateCurrentRoomDisplay();
        connect();

        document.querySelector(".btn-outline-primary").addEventListener("click", createRoom);
        document.getElementById("messageInput").addEventListener("keypress", function(e) {
            if (e.key === "Enter") {
                sendMessage();
            }
        });
        if (window.currentUserRole === "admin") {
            loadUsers();
        }
        window.history.replaceState({}, document.title, "/chat");
    }

    async function loadRooms() {
        console.log("Loading rooms with token:", token);
        const headers = { "Authorization": `Bearer ${token}` };
        console.log("Request headers:", headers);
        const response = await fetch("/rooms", {
            headers: headers
        });
        if (!response.ok) {
            console.error("Failed to load rooms:", response.status, response.statusText);
            alert("Ошибка загрузки комнат. Возможно, токен истек.");
            logout();
            return;
        }
        const result = await response.json();
        const roomList = document.getElementById("room-list");
        roomList.innerHTML = "";
        result.rooms.forEach(room => {
            const item = document.createElement("div");
            item.className = "list-group-item d-flex justify-content-between align-items-center";
            item.innerHTML = `
                <button class="btn btn-link p-0" onclick="switchRoom('${room}')">${room}</button>
                ${window.currentUserRole === "admin" ? `<button class="btn btn-danger btn-sm" onclick="deleteRoom('${room}')">Удалить</button>` : ""}
            `;
            roomList.appendChild(item);
        });
    }

    async function createRoom() {
        const roomName = document.getElementById("new-room").value;
        if (!roomName) {
            alert("Введите название комнаты!");
            return;
        }
        if (!token) {
            console.error("No token available for room creation");
            alert("Токен отсутствует. Пожалуйста, войдите заново.");
            logout();
            return;
        }
        console.log("Creating room with token:", token);
        const response = await fetch("/rooms", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ name: roomName })
        });
        if (!response.ok) {
            console.error("Failed to create room:", response.status, response.statusText);
            if (response.status === 401) {
                alert("Ошибка авторизации. Токен истек или недействителен.");
                logout();
            } else {
                alert("Ошибка создания комнаты.");
            }
            return;
        }
        const result = await response.json();
        alert(result.message);
        document.getElementById("new-room").value = "";
        await loadRooms();
    }

    async function deleteRoom(roomName) {
        if (!confirm(`Вы уверены, что хотите удалить комнату "${roomName}"?`)) return;
        console.log("Deleting room with token:", token);
        const response = await fetch(`/rooms/${roomName}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            console.error("Failed to delete room:", response.status, response.statusText);
            if (response.status === 401) {
                alert("Ошибка авторизации. Токен истек или недействителен.");
                logout();
            } else if (response.status === 403) {
                alert("Требуются права администратора.");
            } else {
                alert("Ошибка удаления комнаты.");
            }
            return;
        }
        const result = await response.json();
        alert(result.message);
        if (currentRoom === roomName) {
            currentRoom = "General";
            connect();
            updateCurrentRoomDisplay(); 
        }
        await loadRooms();
    }

    async function loadUsers() {
        console.log("Loading users with token:", token);
        const response = await fetch("/users", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            console.error("Failed to load users:", response.status, response.statusText);
            return;
        }
        const result = await response.json();
        const userList = document.getElementById("user-list");
        userList.innerHTML = "";
        result.users.forEach(user => {
            const item = document.createElement("div");
            item.className = "d-flex justify-content-between align-items-center mb-2";
            item.innerHTML = `
                <span>${user.login} (${user.full_name}) - ${user.role}</span>
                ${user.login !== "admin" ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${user.login}')">Удалить</button>` : ""}
            `;
            userList.appendChild(item);
        });
    }

    async function addUser() {
        const login = document.getElementById("new-user-login").value;
        const fullName = document.getElementById("new-user-fullname").value;
        const password = document.getElementById("new-user-password").value;
        if (!login || !fullName || !password) {
            alert("Заполните все поля!");
            return;
        }
        console.log("Adding user with token:", token);
        const response = await fetch("/users", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ login, full_name: fullName, password, role: "user" })
        });
        if (!response.ok) {
            console.error("Failed to add user:", response.status, response.statusText);
            alert("Ошибка добавления пользователя.");
            return;
        }
        const result = await response.json();
        alert(result.message);
        document.getElementById("new-user-login").value = "";
        document.getElementById("new-user-fullname").value = "";
        document.getElementById("new-user-password").value = "";
        await loadUsers();
    }

    async function deleteUser(login) {
        if (!confirm(`Вы уверены, что хотите удалить пользователя "${login}"?`)) return;
        console.log("Deleting user with token:", token);
        const response = await fetch(`/users/${login}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            console.error("Failed to delete user:", response.status, response.statusText);
            alert("Ошибка удаления пользователя.");
            return;
        }
        const result = await response.json();
        alert(result.message);
        await loadUsers();
    }

    function switchRoom(room) {
        if (currentRoom !== room) {
            currentRoom = room;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            setTimeout(connect, 100);
            updateCurrentRoomDisplay(); 
            loadRooms();
        }
    }

    function updateCurrentRoomDisplay() {
        const currentRoomElement = document.getElementById("current-room");
        if (currentRoomElement) {
            currentRoomElement.textContent = `Текущая комната: ${currentRoom}`;
        }
    }

    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        console.log("Connecting to:", `wss://vkudryavtsev.u6607.ru/ws/${currentRoom}/${username}?token=${token}`);
        ws = new WebSocket(`wss://vkudryavtsev.u6607.ru/ws/${currentRoom}/${username}?token=${token}`);

        ws.onmessage = function(event) {
            const data = JSON.parse(event.data);
            const messagesDiv = document.getElementById("messages");

            if (data.type === "history") {
                messagesDiv.innerHTML = "";
                data.messages.forEach(msg => addMessage(msg));
            } else if (data.type === "message") {
                addMessage(data);
            } else if (data.type === "system") {
                addSystemMessage(data.message);
            } else if (data.type === "delete_message") {
                const messageElement = document.querySelector(`.message[data-id="${data.message_id}"]`);
                if (messageElement) messageElement.remove();
            }
        };

        ws.onopen = function() {
            console.log("WebSocket connected");
            document.getElementById("messageInput").disabled = false;
            document.getElementById("sendBtn").disabled = false;
        };

        ws.onerror = function(error) {
            console.error("WebSocket error:", error);
            alert("Ошибка подключения. Возможно, токен истек.");
            logout();
        };

        ws.onclose = function(event) {
            console.log("WebSocket closed:", event);
            document.getElementById("messageInput").disabled = true;
            document.getElementById("sendBtn").disabled = true;
        };
    }

    function addMessage(data) {
        const messagesDiv = document.getElementById("messages");
        const msg = document.createElement("div");
        msg.className = "message";
        msg.setAttribute("data-id", data.id);
        const canDelete = data.username === username || window.currentUserRole === "admin";
        console.log("Can delete message:", canDelete, "Username:", data.username, "Role:", window.currentUserRole);
        msg.innerHTML = `
            <img src="${data.avatar || '/static/avatars/default.png'}" class="avatar" alt="${data.username[0]}">
            <div class="content">
                <strong>${data.full_name} (${data.username})</strong> <small class="text-muted">[${data.timestamp}]</small>
                ${canDelete ? `<button class="btn btn-danger btn-sm float-end" onclick="deleteMessage(${data.id})">Удалить</button>` : ""}
                <br>${data.message}
            </div>
        `;
        messagesDiv.appendChild(msg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addSystemMessage(message) {
        const messagesDiv = document.getElementById("messages");
        const msg = document.createElement("div");
        msg.className = "message system";
        msg.innerHTML = `<div class="content">${message}</div>`;
        messagesDiv.appendChild(msg);
    }

    async function deleteMessage(messageId) {
        if (!confirm("Вы уверены, что хотите удалить это сообщение?")) return;
        console.log("Deleting message with token:", token);
        const response = await fetch(`/messages/${messageId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            console.error("Failed to delete message:", response.status, response.statusText);
            if (response.status === 401) {
                alert("Ошибка авторизации. Токен истек или недействителен.");
                logout();
            } else if (response.status === 403) {
                alert("Вы не можете удалять чужие сообщения.");
            } else {
                alert("Ошибка удаления сообщения.");
            }
            return;
        }
        const result = await response.json();
        alert(result.message);
    }

    function sendMessage() {
        const input = document.getElementById("messageInput");
        if (ws && ws.readyState === WebSocket.OPEN && input.value) {
            ws.send(JSON.stringify({message: input.value}));
            input.value = "";
        } else {
            console.log("WebSocket is not open. State:", ws ? ws.readyState : "undefined");
            alert("Нельзя отправить сообщение: соединение закрыто. Переподключитесь.");
        }
    }

    function logout() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        localStorage.removeItem("username");
        window.location.href = "/login";
    }

    window.switchRoom = switchRoom;
    window.createRoom = createRoom;
    window.deleteRoom = deleteRoom;
    window.addUser = addUser;
    window.deleteUser = deleteUser;
    window.deleteMessage = deleteMessage;
    window.sendMessage = sendMessage;
    window.logout = logout;
})();
