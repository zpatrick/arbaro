# Backlog

Open thoughts. Nothing here is decided.

## Root view

Right now the ground and the tree are the same color, just very dark. That reads well, and it should stay the default.

A button flips into a mode for looking at the root system. In that mode, everything above the ground becomes secondary — opaque, blurry, or some other way of receding — and the ground shows the roots. The roots should read as distinct from the ground. Maybe the ground shifts color a little, or becomes opaque so the roots stand out. The two views should feel like they trade places: roots matter in this mode, and turning it off puts the above-ground tree back in focus.

Inside the root view:

- The default is the shape and size already used above ground, so the roots can be steered the same way.
- A toggle shows how much water each root is bringing in. Color is one option: more water reads more blue, less water more brown or black. Another option is animation. Tiny droplets enter through the tendrils. When two meet they join into one larger droplet, and they travel back up toward the base of the trunk. Frequency and size of the droplets show how much or how little is being taken up. Small tendrils pull in small droplets; as they move up the roots the droplets get larger and combine.
- A separate overlay for strength or structural strength is a maybe. Branch size already makes that fairly obvious, so it may not be worth it.

While the ground is visible, other underground things could show up too: an underground lake, or rocks the roots should avoid. Interesting, not urgent.

## Above-ground physics, roots as limits

The physics above ground and the physics below ground should be clearly separate. They may already be mostly separate; make that explicit.

The physics engine only cares about the above-ground tree. Roots do not simulate as their own bodies. What they contribute is a constraint on what that tree is allowed to be.

A couple of ways that could work:

- Roots add weight at the base of the trunk, so a more heavily rooted tree is physically the same as one with more weight planted there.
- Root amount limits how tall or long the trunk can get. Bigger roots are required before the tree can grow taller. Something like a level: to pass a height or length (five meters, say), you need a corresponding amount of root mass. An integer tied to how much root you have, and that integer is the requirement you have to meet before you can build past that height or length.

Either way, the physics stays simple because it only sees the above-ground tree. In play you also are not looking at the roots while you care about the physics, so those two concerns stay apart.

## Growth and decay

Water is the currency.

Decay rises with tree mass: more branches, a thicker trunk, a taller trunk. A larger branch decays faster. A larger stem decays faster. More tree means a higher decay rate.

If more is coming in than the decay rate, that part keeps growing. If less is coming in than the decay rate, it starts to die from the leaf nodes: the top of the trunk, the edges of the branches. There is no separate homeostasis rate that overrides this. Homeostasis is just the point where what comes in matches decay, so the part stays as it is. Branches, stems, and flowers all work that way from the start.

## Building branches

Dots stand for the plant's energy. The name is unclear. They guessed chloroplasts and were not sure.

A flower is another node type, and it is always a leaf. It gets resources dedicated to it the same way a branch or a stem does, and it needs enough of them. It also brings in light energy, which is a different currency. How that connects, and why you would use it, is still open.

On each valve, a setting that holds its branch where incoming matches decay is still open.

## Bears and level goals

The bear may go after something other than hives, such as seeds or leaves. That is still open.

A level's goal might be something other than height and flower count. Killing a number of bears, five say, is one example. What those goals actually are is still open.
