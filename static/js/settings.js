async function updateSettings() {
    const avatarInput = document.getElementById("avatar");
    const fullName = document.getElementById("full_name").value;
    const password = document.getElementById("password").value;
    const token = document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1];

    if (!token) {
        alert("Токен отсутствует. Пожалуйста, войдите заново.");
        window.location.href = "/login";
        return;
    }

    const formData = new FormData();
    if (avatarInput.files.length > 0) {
        formData.append("avatar", avatarInput.files[0]);
    }
    formData.append("full_name", fullName);
    if (password) {
        formData.append("password", password);
    }

    console.log("Sending update with token:", token);
    const response = await fetch("/settings", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`
        },
        body: formData
    });

    const result = await response.json();
    if (response.ok) {
        console.log("Settings updated:", result);
        alert("Настройки успешно обновлены!");
        window.location.reload(); 
    } else {
        console.error("Failed to update settings:", result.detail);
        alert(result.detail || "Ошибка обновления настроек");
    }
}

function logout() {
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    localStorage.removeItem("username");
    window.location.href = "/login";
}
