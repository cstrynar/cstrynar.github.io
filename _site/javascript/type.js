const text = "Chris Strynar";

function typeText(text) {
    let index = 0;
    function type() {
        if (index < text.length) {
            document.getElementById("Chris-Strynar").textContent += text[index];
            index++;
            setTimeout(type, 150); // delay 100 milliseconds
            if (text[index] == " ") {
                setTimeout(type, 300);
            }
        }
    }
    type();
  }
  
typeText(text);
