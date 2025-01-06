---
title: "Zubio to Laika"
date: 2024-06-24T15:27:55-07:00
draft: false
cover:
    image: "/blog/moving-to-laika/laika-sign.jpg"
---

In November of 2023, I accepted a job as a Pipeline TD at LAIKA Studios. This has brought about a lot of changes, most notably the size of the company; Zubio was a boutique operation with ~15 employees, of which I was the only programmer/tech specialist, while LAIKA has around 700 people on staff, with a dedicated technology team of about 70.

The most notable change is the shift from "I've built everything here, so I know how it all works" to "Figure out how to plug into existing systems".

In some ways, this is really nice. At Zubio, I really wanted to set up automated CI/CD pipelines to automatically test and deliver code changes to the studio. However, we didn't have the time or budget for me to get this all set up, so testing code became a mostly manual process. At LAIKA, the engineering team has set up robust testing systems with easy-to-use templates to use in new projects. All I have to do is copy a few files into my project and tests automatically run on a whole suite of machines.

While it's sometimes difficult to have to navigate a new system, it's also nice to have a lot of the work done for me. I can focus on the specifics of my project and not have to worry about setting up a whole new system from scratch.

Another shift has been learning how to ask others for help. This may seem obvious, but at Zubio, if there was a problem, there WAS no other person to ask (other than Google and StackOverflow).

I've learned there's an art to asking for help. People are often busy and can't respond right away, so even though communication is instantaneous, it's better to provide all the information possible up front.
It's also just courteous to give people the information they need so they don't have to take extra time to figure out something you could have easily told them.

I've also seen the importance of the [XY problem](https://xyproblem.info/) - when asking someone for help, ask about your actual problem and not just your solution to the problem, because there are often better ways to accomplish the exact thing you're trying to do. Many times during standup meetings, I've brought up a problem I'm encountering, and a team member suggests a different approach that works much better.

I've also learned about several tools/libraries that already exist to solve problems I tried to resolve myself, such as [pydantic](https://docs.pydantic.dev/latest/). While at Zubio, we needed a way to validate JSON data and turn it into Python objects. I wrote a bunch of custom code to do this, which worked, but was not as robust as pydantic.
I'm still grateful for the learning experience of writing that code, but I'll stick with pydantic from now on. (A few others are [QSettings](https://doc.qt.io/qtforpython-5/PySide2/QtCore/QSettings.html) and [pathlib.Path](https://docs.python.org/3/library/pathlib.html#pathlib.Path)).

Overall, I'm very excited to be working at a larger studio on larger projects. This seems like a great opportunity to learn first-hand how larger systems are architected and maintained, and I'm looking forward to learning from the senior engineers I work with.
