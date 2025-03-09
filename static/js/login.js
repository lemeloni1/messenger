async function login() {
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    const recaptchaResponse = grecaptcha.getResponse();

    console.log("reCAPTCHA response:", recaptchaResponse);

    if (!username || !password) {
        alert("Заполните все поля!");
        return;
    }
    if (!recaptchaResponse) {
        alert("Пожалуйста, подтвердите, что вы не робот!");
        return;
    }

    const response = await fetch("/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: username,
            password: password,
            "g-recaptcha-response": recaptchaResponse
        })
    });

    const result = await response.json();
    if (response.ok) {
        console.log("Login successful, token:", result.access_token);
        
        document.cookie = `token=${result.access_token}; path=/; max-age=1800; SameSite=Lax`;
        localStorage.setItem("username", username); 
        console.log("Token saved in cookie:", result.access_token);
        window.location.href = "/chat";
    } else {
        console.error("Login failed:", result.detail);
        alert(result.detail || "Ошибка входа");
    }
}
