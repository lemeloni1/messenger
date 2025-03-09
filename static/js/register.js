async function register() {
    const login = document.getElementById("reg-login").value;
    const fullName = document.getElementById("reg-fullname").value;
    const password = document.getElementById("reg-password").value;
    const recaptchaResponse = grecaptcha.getResponse(); 

    if (!login || !fullName || !password) {
        alert("Заполните все поля!");
        return;
    }
    if (!recaptchaResponse) {
        alert("Пожалуйста, подтвердите, что вы не робот!");
        return;
    }

    const response = await fetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            login: login,
            full_name: fullName,
            password: password,
            "g-recaptcha-response": recaptchaResponse 
        })
    });

    const result = await response.json();
    if (response.ok) {
        alert(result.message);
        window.location.href = "/login";
    } else {
        alert(result.detail || "Ошибка регистрации");
    }
}
