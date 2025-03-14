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
        const headers = { "Authorization": `Bearer ${token}` };
        const response = await fetch("/rooms", { headers });
        if (!response.ok) {
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
        const response = await fetch("/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ name: roomName })
        });
        if (!response.ok) {
            alert("Ошибка создания комнаты.");
            return;
        }
        const result = await response.json();
        alert(result.message);
        document.getElementById("new-room").value = "";
        await loadRooms();
    }

    async function deleteRoom(roomName) {
        if (!confirm(`Вы уверены, что хотите удалить комнату "${roomName}"?`)) return;
        const response = await fetch(`/rooms/${roomName}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            alert("Ошибка удаления комнаты.");
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
        const response = await fetch("/users", { headers: { "Authorization": `Bearer ${token}` } });
        if (!response.ok) return;
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
        const response = await fetch("/users", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ login, full_name: fullName, password, role: "user" })
        });
        if (!response.ok) {
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
        const response = await fetch(`/users/${login}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
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
            document.getElementById("mediaInput").disabled = false;
            document.getElementById("sendBtn").disabled = false;
        };

        ws.onclose = function(event) {
            console.log("WebSocket closed:", event);
            document.getElementById("messageInput").disabled = true;
            document.getElementById("mediaInput").disabled = true;
            document.getElementById("sendBtn").disabled = true;
        };

        ws.onerror = function(error) {
            console.error("WebSocket error:", error);
            alert("Ошибка подключения. Возможно, токен истек.");
            logout();
        };
    }

    function addMessage(data) {
        const messagesDiv = document.getElementById("messages");
        const msg = document.createElement("div");
        msg.className = "message";
        msg.setAttribute("data-id", data.id);
        const canDelete = data.username === username || window.currentUserRole === "admin";
        // Обрезаем наносекунды из timestamp
        const timestamp = data.timestamp.split('.')[0];
        let mediaContent = "";
        if (data.media_url) {
            const ext = data.media_url.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
                mediaContent = `<img src="${data.media_url}" class="img-fluid mt-2" style="max-width: 300px;" alt="Media">`;
            } else if (['mp4', 'webm'].includes(ext)) {
                mediaContent = `<video controls class="mt-2" style="max-width: 300px;"><source src="${data.media_url}" type="video/${ext}"></video>`;
            } else if (['mp3', 'wav'].includes(ext)) {
                mediaContent = `<audio controls class="mt-2"><source src="${data.media_url}" type="audio/${ext}"></audio>`;
            } else {
                mediaContent = `<a href="${data.media_url}" target="_blank" class="mt-2">Скачать файл</a>`;
            }
        }
        msg.innerHTML = `
            <img src="${data.avatar || '/static/avatars/default.png'}" class="avatar" alt="${data.username[0]}">
            <div class="content">
                <strong>${data.full_name} (${data.username})</strong> <small class="text-muted">[${timestamp}]</small>
                ${canDelete ? `<button class="btn btn-danger btn-sm float-end" onclick="deleteMessage(${data.id})">Удалить</button>` : ""}
                <br>${data.message || ""}
                ${mediaContent}
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
        const response = await fetch(`/messages/${messageId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!response.ok) {
            alert("Ошибка удаления сообщения.");
            return;
        }
        const result = await response.json();
        alert(result.message);
    }

    async function sendMessage() {
        const input = document.getElementById("messageInput");
        const mediaInput = document.getElementById("mediaInput");
        const message = input.value;
        let mediaUrl = null;

        if (mediaInput.files.length > 0) {
            const formData = new FormData();
            formData.append("file", mediaInput.files[0]);
            formData.append("room", currentRoom);
            const response = await fetch("/upload", {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });
            if (!response.ok) {
                const error = await response.json();
                alert(`Ошибка загрузки файла: ${error.detail || "Неизвестная ошибка"}`);
                return;
            }
            const result = await response.json();
            mediaUrl = result.media_url;
        }

        if (ws && ws.readyState === WebSocket.OPEN && (message || mediaUrl)) {
            ws.send(JSON.stringify({ message: message || "", media_url: mediaUrl }));
            input.value = "";
            mediaInput.value = "";
        } else {
            alert("Нельзя отправить сообщение: соединение закрыто.");
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
