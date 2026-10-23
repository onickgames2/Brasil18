function post(url, data, tentativas) {
    tentativas = tentativas === undefined ? 2 : tentativas;

    return new Promise(function (res, rej) {
        $.ajax({
            type: "POST",
            url: "/admin-api/api/" + url,
            data: data === undefined ? undefined : JSON.stringify(data),
            contentType: "application/json",
            headers: {
                'x-csrf-token': csrf,
            },
            dataType: "text", // evita erro de parse quando a resposta vem vazia
            complete: function (xhr) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var resultado = xhr.responseText;
                    try { resultado = JSON.parse(resultado); } catch (e) {}
                    return res(resultado);
                }

                var newCsrf = xhr.getResponseHeader("x-csrf-token");
                if (newCsrf && tentativas > 0) {
                    csrf = newCsrf;
                    return post(url, data, tentativas - 1).then(res).catch(rej);
                }

                $('#errorMessage').text(xhr.responseText);
                rej(xhr);
            }
        });
    });
}
