# Diagram Test Data (MCBSMD Format)

**mermaid_flowchart:**

```mermaid
graph TD
    A-->|Go|B
    A-->|Skip|C
    B-->|Done|D
    C-->|Done|D
```

**mermaid_sequence:**

```mermaid
sequenceDiagram
    Alice->>Bob: Hello_Bob
    Bob-->>Alice: Hello_Alice
```

**Super Big Sequence Diagram in Mermaid:**

```mermaid
sequenceDiagram
    participant User
    participant CDN
    participant LB as LoadBalancer
    participant WAF
    participant API as APIGateway
    participant Auth as AuthServer
    participant UDB as UserDB
    participant Sess as SessionMgr
    participant Main as main.js
    participant Scan as VirusScanner
    participant Chk as FormatChecker
    participant Meta as MetaDataParser
    participant Mon as ResourceMonitor
    participant Log as LogServer
    participant Met as MetricsCollector
    participant Cfg as ConfigDB
    participant Encode as EncodeUseCase
    participant Tmp as TmpStorage
    participant Audit as AuditDB
    participant Comp as CompressorAdapter
    participant Cap as CapacityCalc
    participant Img as ImageAdapter
    participant Pack as MatryoshkaPacker
    participant KMS as KeyManagement
    participant Crypto as CryptoAdapter
    participant Stripe as StripingEngine
    participant Lsb as LsbEngine
    participant Analyt as Analytics
    participant Clean as CleanupService
    participant Notif as Notifier

    User ->> CDN: drop(TreasureMapFile, OriginalCat, OriginalDog)
    CDN ->> LB: forward request
    LB ->> WAF: inspect payload
    WAF -->> LB: payload clean
    LB ->> API: route request
    API ->> Main: init encode process
    Main ->> Auth: validate token
    Auth ->> UDB: query user status
    UDB -->> Auth: user active
    Auth -->> Main: token valid
    Main ->> Sess: update session heartbeat
    Sess -->> Main: session updated
    Main ->> Scan: scan files for malware
    Scan -->> Main: files safe
    Main ->> Chk: verify file formats
    Chk -->> Main: formats supported
    Main ->> Meta: extract metadata
    Meta -->> Main: metadata parsed
    Main ->> Mon: check memory availability
    Mon -->> Main: memory sufficient
    Main ->> Log: log process start
    Log -->> Main: logged
    Main ->> Met: increment request counter
    Met -->> Main: metrics updated
    Main ->> Cfg: fetch encode parameters
    Cfg -->> Main: params loaded

    Main ->> Encode: execute(tmBytes, fileName, catRaw, dogRaw, ...)
    Encode ->> Tmp: store raw inputs temporarily
    Tmp -->> Encode: stored
    Encode ->> Audit: log encode initialization
    Audit -->> Encode: logged

    Encode ->> Comp: compress(tmBytes)
    Comp -->> Encode: return compressedTM
    Encode ->> Log: log compression ratio
    Log -->> Encode: logged

    Encode ->> Cap: selectResolution(compressedTM.length, ...)
    Cap -->> Encode: return {newWidth, newHeight, capacity}

    Encode ->> Img: resizeStretch(catRaw, newWidth, newHeight)
    Img -->> Encode: return resizedCatPixels
    Encode ->> Img: resizeStretch(dogRaw, newWidth, newHeight)
    Img -->> Encode: return resizedDogPixels

    Encode ->> Pack: packLayer3(compressedTM, fileName)
    Pack -->> Encode: return plaintext

    Encode ->> KMS: request encryption key
    KMS -->> Encode: return key and iv
    Encode ->> Crypto: encrypt(plaintext, key, iv)
    Crypto -->> Encode: return ciphertext
    Encode ->> Audit: log encryption success
    Audit -->> Encode: logged

    Encode ->> Pack: packLayer2(key, iv, ciphertext)
    Pack -->> Encode: return encryptedStream

    Encode ->> Stripe: stripe(encryptedStream)
    Stripe -->> Encode: return {evenBytes, oddBytes}

    Encode ->> Pack: packLayer1(evenBytes, isEven_true)
    Pack -->> Encode: return catPayload
    Encode ->> Pack: packLayer1(oddBytes, isEven_false)
    Pack -->> Encode: return dogPayload

    Encode ->> Lsb: lsbInterleave(resizedCatPixels, catPayload, 3)
    Lsb -->> Encode: return catStegoPixels
    Encode ->> Lsb: lsbInterleave(resizedDogPixels, dogPayload, 3)
    Lsb -->> Encode: return dogStegoPixels

    Encode ->> Tmp: store stego outputs temporarily
    Tmp -->> Encode: stored
    Encode ->> Analyt: record generation metrics
    Analyt -->> Encode: recorded

    Encode -->> Main: return {catStegoPixels, dogStegoPixels, ...}

    Main ->> Img: toBlob(catStegoPixels, width, height)
    Img -->> Main: return catBlob
    Main ->> Img: toBlob(dogStegoPixels, width, height)
    Img -->> Main: return dogBlob

    Main ->> Clean: trigger temp file cleanup
    Clean -->> Main: cleanup complete
    Main ->> Notif: prepare download URLs
    Notif -->> Main: URLs ready

    Main -->> API: response ready
    API -->> LB: route response
    LB -->> CDN: forward response
    CDN -->> User: hide spinner and enable download
```

**mermaid_class:**

```mermaid
classDiagram
    class Animal
    class Duck
    class Fish
    Animal <|-- Duck : Inherits
    Animal <|-- Fish : Inherits
    Animal : +int age
    Animal : +String gender
```

**mermaid_state:**

```mermaid
stateDiagram-v2
    [*] --> Still : Init
    Still --> Moving : Walk
    Moving --> Still : Stop
    Moving --> Crash : Accident
    Crash --> [*] : End
```

**mermaid_er:**

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
```

**mermaid_gantt:**

```mermaid
gantt
    title A_Gantt_Diagram
    dateFormat  YYYY-MM-DD
    section Section
    A_task           :a1, 2024-01-01, 30d
    Another_task     :after a1  , 20d
```

**mermaid_pie:**

```mermaid
pie
    title Key Elements
    "Calcium" : 42
    "Potassium" : 50
    "Magnesium" : 8
```

**mermaid_quadrant:**

```mermaid
quadrantChart
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
```

**mermaid_mindmap:**

```mermaid
mindmap
  root((mindmap))
    Origins
      Long history
      Popularisation
    Research
      On effectiveness
      On automatic creation
```

**mermaid_timeline:**

```mermaid
timeline
    title History_of_Social_Media
    2002 : LinkedIn
    2004 : Facebook
         : Google
    2005 : Youtube
    2006 : Twitter
```

**mermaid_sankey:**

```mermaid
sankey-beta
    Bio-conversion,Losses,26.862
    Bio-conversion,Solid,280.322
    Bio-conversion,Gas,81.144
```

**mermaid_journey:**

```mermaid
journey
    title My_working_day
    section Go_to_work
      Make_tea: 5: Me
      Go_upstairs: 3: Me
      Do_work: 1: Me, Cat
    section Go_home
      Go_downstairs: 5: Me
      Sit_down: 5: Me
```

**mermaid_xychart:**

```mermaid
xychart-beta
    title "Sales Revenue"
    x-axis [jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec]
    y-axis "Revenue" 4000 --> 11000
    bar [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]
    line [5000, 6000, 7500, 8200, 9500, 10500, 11000, 10200, 9200, 8500, 7000, 6000]
```

**mermaid_requirement:**

```mermaid
requirementDiagram
    requirement test_req {
    id: 1
    text: the test requirement
    risk: high
    verifymethod: test
    }
    element test_entity {
    type: simulation
    }
    test_entity - satisfies -> test_req
```

**plantuml_usecase:**

```plantuml
@startuml
:User: --> (Use_case_1) : Access
:User: -> (Use_case_2) : Access
@enduml
```

**plantuml_component:**

```plantuml
@startuml
[First_Component]
[Second_Component]
[First_Component] --> [Second_Component] : Depends_on
@enduml
```

**plantuml_object:**

```plantuml
@startuml
object user {
  name = "Dummy"
  id = 123
}
object group {
  name = "Admins"
}
user --> group : Belongs_to
@enduml
```

**plantuml_deployment:**

```plantuml
@startuml
node "Web_Server" {
  [Apache]
}
database "DB" {
  [MySQL]
}
[Apache] --> [MySQL] : Reads_Writes
@enduml
```

**plantuml_timing:**

```plantuml
@startuml
robust "Web_Browser" as WB
concise "Web_User" as WU

@0
WU is Idle
WB is Idle

@100
WU is Waiting
WB is Processing

@300
WB is Waiting
@enduml
```

**plantuml_wbs:**

```plantuml
@startwbs
* Project_WBS
** Launch_phase
*** Research
*** Plan
** Design_Phase
*** Model_AsIs
*** Model_ToBe
@endwbs
```

**plantuml_json:**

```plantuml
@startjson
{
   "fruit":"Apple",
   "size":"Large",
   "color": ["Red", "Green"]
}
@endjson
```

**plantuml_yaml:**

```plantuml
@startyaml
fruit: Apple
size: Large
color:
  - Red
  - Green
@endyaml
```

**python_code:**

```python
def fibonacci(n):
    if n <= 1:
        return n
    else:
        return fibonacci(n-1) + fibonacci(n-2)

print([fibonacci(i) for i in range(10)])
```

A recursive function to calculate Fibonacci numbers and a list comprehension to print the first 10.

**javascript_code:**

```javascript
const greet = (name) => {
  const message = `Hello, ${name}!`;
  console.log(message);
};

const users = ["Alice", "Bob", "Charlie"];
users.forEach((user) => greet(user));
```

Arrow functions, template literals, and array iteration in JavaScript.

**contents_name:**
typescript_code

```typescript
interface User {
  id: number;
  username: string;
}

function printUser(user: User): void {
  console.log(`User ${user.id}: ${user.username}`);
}

const admin: User = { id: 1, username: "admin_user" };
printUser(admin);
```

TypeScript example showing interface definition and type annotations.

**contents_name:**
go_code

```go
package main

import "fmt"

func main() {
    c := make(chan string)
    go func() {
        c <- "Hello from Goroutine"
    }()
    msg := <-c
    fmt.Println(msg)
}
```

A basic Go program demonstrating channels and Goroutines for concurrency.

**contents_name:**
rust_code

```rust
fn main() {
    let numbers = vec![1, 2, 3, 4, 5];
    let doubled: Vec<i32> = numbers.iter()
        .map(|&x| x * 2)
        .collect();

    println!("Doubled: {:?}", doubled);
}
```

Rust example using vectors, iterators, and closures for functional-style processing.

**contents_name:**
java_code

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> items = new ArrayList<>();
        items.add("Apple");
        items.add("Banana");

        for (String item : items) {
            System.out.println("Item: " + item);
        }
    }
}
```

Standard Java class structure using generic Lists and an enhanced for-loop.

**c_code:**

```c
#include <stdio.h>

int main() {
    int arr[] = {10, 20, 30, 40, 50};
    int len = sizeof(arr) / sizeof(arr[0]);

    for(int i = 0; i < len; i++) {
        printf("Element %d: %d\n", i, arr[i]);
    }
    return 0;
}
```

Classic C program iterating over an integer array with pointer arithmetic logic.

**contents_name:**
cpp_code

```cpp
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v = {1, 2, 3, 4, 5};
    for(const auto& val : v) {
        std::cout << val << " ";
    }
    std::cout << std::endl;
    return 0;
}
```

Modern C++ using `std::vector` and range-based for loops.

**contents_name:**
csharp_code

```csharp
using System;
using System.Linq;

class Program {
    static void Main() {
        int[] numbers = { 5, 10, 8, 3, 6, 12 };
        var query = from num in numbers
                    where num % 2 == 0
                    orderby num
                    select num;

        foreach (var n in query) {
            Console.WriteLine(n);
        }
    }
}
```

C# example demonstrating LINQ query syntax to filter and sort an array.

**contents_name:**
ruby_code

```ruby
class Greeter
  def initialize(name = "World")
    @name = name
  end

  def say_hi
    puts "Hi #{@name}!"
  end
end

g = Greeter.new("Rubyist")
g.say_hi
```

Ruby class definition, instance variables, and method invocation.

**php_code:**

```php
<?php
function sum(...$numbers) {
    $acc = 0;
    foreach ($numbers as $n) {
        $acc += $n;
    }
    return $acc;
}

echo "Sum: " . sum(1, 2, 3, 4);
?>
```

PHP script showing variadic functions and variable iteration.

**swift_code:**

```swift
let names = ["Anna", "Alex", "Brian", "Jack"]
let count = names.count

for (index, name) in names.enumerated() {
    print("Item \(index + 1): \(name)")
}
```

Swift example using array properties and the `enumerated()` method for loops.

**kotlin_code:**

```kotlin
fun main() {
    val items = listOf("apple", "banana", "kiwifruit")
    items.filter { it.startsWith("a") }
         .sortedBy { it }
         .map { it.uppercase() }
         .forEach { println(it) }
}
```

Kotlin code using collection extension functions for functional processing.

**bash_code:**

```bash
#!/bin/bash
count=1
while [ $count -le 5 ]
do
    echo "Count is $count"
    ((count++))
done
```

A simple Bash shell script demonstrating a while loop and arithmetic expansion.

**sql_code:**

```sql
SELECT
    u.username,
    COUNT(o.order_id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.active = 1
GROUP BY u.username
ORDER BY order_count DESC;
```

Standard SQL query involving JOINs, aggregation, filtering, and sorting.

**html_code:**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Sample Page</title>
  </head>
  <body>
    <div id="container">
      <h1>Hello World</h1>
      <p>This is a paragraph.</p>
    </div>
  </body>
</html>
```

Basic HTML5 document structure.

**css_code:**

```css
body {
  font-family: Arial, sans-serif;
  background-color: #f0f0f0;
}

.container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
}
```

CSS sample showing Flexbox layout properties.

**json_data:**

```json
{
  "project": "MCBSMD",
  "version": 1.0,
  "supported_languages": ["Python", "JavaScript", "Go", "Rust"],
  "active": true
}
```

A typical JSON data structure.

# Math Rendering & Diagram Test Suite

This document demonstrates the rendering capabilities for mathematical formulas (KaTeX), UML diagrams (Mermaid), and code highlighting.

---

## 1. Classical Algebra & Number Theory

### Euler's Identity

Often cited as the most beautiful equation in mathematics.

$$
e^{i\pi} + 1 = 0
$$

### The Quadratic Formula

The solution for the quadratic equation $ax^2 + bx + c = 0$.

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

---

## 2. Calculus & Analysis

### Definition of Derivative

The derivative is defined as the limit of the difference quotient.

$$
f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
$$

### The Gaussian Integral

An important integral in probability theory.

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

---

## 3. Linear Algebra

### Matrix Operations

Here is a $3 \times 3$ matrix $A$ and a vector $\vec{v}$.

$$
A = \begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}, \quad
\vec{v} = \begin{pmatrix}
x \\
y \\
z
\end{pmatrix}
$$

### Determinant

$$
\det(A) = \sum_{\sigma \in S_n} \text{sgn}(\sigma) \prod_{i=1}^n a_{i, \sigma(i)}
$$

---

## 4. Physics (Maxwell's Equations)

Using the `aligned` environment for multi-line equations.

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0\mathbf{J} + \mu_0\varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$

---

## 5. Statistical Mechanics (Partition Function)

$$
Z = \sum_{i} e^{-\beta E_i}
$$

Where $\beta = \frac{1}{k_B T}$.

---

## 6. Logic & Flow

Below is a visualization of how a mathematical problem is solved using a computational approach.

**problem_solving_flow:**

```mermaid
flowchart LR
    Problem_Input -->|Defines| Mathematical_Model
    Mathematical_Model -->|Requires| Algorithm_Selection
    Algorithm_Selection -->|Executes| Computation
    Computation -->|Produces| Solution_Output
    Solution_Output -->|Verifies| Problem_Input
```

This diagram illustrates the iterative process of modeling and solving problems.

---

## 7. Implementation Example

A simple Python implementation for the quadratic formula mentioned in Section 1.

**quadratic_solver_py:**

```python
import cmath

def solve_quadratic(a, b, c):
    # Calculate the discriminant
    d = (b**2) - (4*a*c)

    # Find two solutions
    sol1 = (-b - cmath.sqrt(d)) / (2*a)
    sol2 = (-b + cmath.sqrt(d)) / (2*a)

    return sol1, sol2
```

This function handles complex roots using the `cmath` library.

---

## 8. Complex Relationships

A class diagram representing a mathematical expression parser structure.

**expression_parser_class_diagram:**

```mermaid
classDiagram
    Expression <|-- BinaryExpression : Inherits
    Expression <|-- Number : Inherits
    BinaryExpression o-- Expression : Contains_Left
    BinaryExpression o-- Expression : Contains_Right

    class Expression {
        +evaluate() double
    }
    class Number {
        +value double
        +evaluate() double
    }
    class BinaryExpression {
        +operator string
        +evaluate() double
    }
```

This structure allows for recursive evaluation of mathematical trees.
