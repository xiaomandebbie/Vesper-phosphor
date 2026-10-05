#!/usr/bin/env python3
"""add_music_multi_step.py — 让听歌和逛论坛一样，一次唤醒能连着走几步。

用法（在仓库根目录）：
    python3 scripts/add_music_multi_step.py --check   # 只看六处能不能打上，不动文件
    python3 scripts/add_music_multi_step.py           # 真打，每个文件先备份

现在是什么样：
  逛论坛可以连着走（discover → show → comment），因为 decide.js 有 forumNextStep、
  phosphor.js 有 continueForum；而听歌只能走一步——查完她最近听什么就结束了，
  想接着翻那首歌的批注、读歌词、刷评论区都得等下一次醒来。

改完是什么样：
  her_recent → memo_read → song_memo 这种一气做完。「看」和「听」的工具做完可以接着走，
  写批注（song_memo）或收进歌单（playlist_add）做完这次就结束——和论坛的读/写一个规矩。

两边的不同：论坛是一条命令字符串（command），点歌台是「工具名＋参数」，
所以 musicNextStep 要回两个字段，去重也按「工具＋参数」一起比。

步数用 .env 的 MUSIC_MAX_STEPS 控，不填是 3，填 0 就是回到只走一步，最多 5。

改两个文件共六处：
  src/decide.js    MUSIC_MAX_STEPS 定义、clipMusicResult、提示词里说明、musicNextStep 函数
  src/phosphor.js  import、读/写工具名单＋continueMusic、调用点、启动日志

原文对不上就整个不改，不猜。出问题：把 .bak-musicsteps 覆回原文件再重启。
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ══ src/decide.js ══

DECIDE = []


def decide_patch(name, old, new):
    DECIDE.append((name, old, new))


# ── 1. 步数上限和返回内容截长 ──
decide_patch(
    "MUSIC_MAX_STEPS 定义",
    """// 论坛每一步返回的内容最多带多少字给模型看
const FORUM_RESULT_MAX_CHARS = 4000;
""",
    """// 论坛每一步返回的内容最多带多少字给模型看
const FORUM_RESULT_MAX_CHARS = 4000;

// 听歌一次醒来最多再多走几步（第一步是醒来时选的那个工具，不算在里面）。
// .env 的 MUSIC_MAX_STEPS 可改，不填是 3，填 0 就是原来那样只走一步，最多 5。
export const MUSIC_MAX_STEPS = (() => {
  const raw = String(process.env.MUSIC_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 3;
})();
// 点歌台每一步返回的内容最多带多少字。歌词、评论区、听感分析都可能很长，比论坛收紧一些
const MUSIC_RESULT_MAX_CHARS = 3000;
""",
)

# ── 2. 返回内容截长 ──
decide_patch(
    "clipMusicResult",
    """function clipForumResult(value) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  return clipText(s, FORUM_RESULT_MAX_CHARS, '\\n…（后面太长，没放进来）');
}
""",
    """function clipForumResult(value) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  return clipText(s, FORUM_RESULT_MAX_CHARS, '\\n…（后面太长，没放进来）');
}

function clipMusicResult(value) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  return clipText(s, MUSIC_RESULT_MAX_CHARS, '\\n…（后面太长，没放进来）');
}
""",
)

# ── 3. 插入 musicSteps 定义（在 musicSection 之前）──
decide_patch(
    "musicSteps 定义",
    "  const musicSection = process.env.MUSIC_MCP_URL",
    """  // 听歌也能连着走几步（和论坛一样）。只跟配置有关，进程不重启就不变，不影响前缀缓存
  const musicSteps = MUSIC_MAX_STEPS
    ? `\\n听歌可以在一次醒来里连着走几步：你用 her_recent / song_search / memo_read / playlists / lyric_read / song_comments / song_listen 这类「看」和「听」的工具时，系统会把返回的内容拿给你看，你可以接着往下翻——查这首歌的批注、读歌词、刷评论、认真听一遍，最多再走 ${MUSIC_MAX_STEPS} 步。写批注（song_memo）或者收进歌单（playlist_add）之后这次就结束。听完没想写的，就停下，这很正常。`
    : '';

  const musicSection = process.env.MUSIC_MCP_URL""",
)

# ── 4. 把 musicSteps 接进听歌那一段末尾 ──
decide_patch(
    "提示词里带上步数说明",
    "不用每次醒来都动歌单，有想说的再写。`\n    : '';",
    "不用每次醒来都动歌单，有想说的再写。${musicSteps}`\n    : '';",
)

# ── 5. musicNextStep 函数（跟在 forumNextStep 后面）──
MUSIC_NEXT_STEP = '''

// ---------- 听歌的下一步 ----------
// messages 是到目前为止的整段对话（最后一条是模型上一次的回答）。
// 把点歌台刚返回的内容追加进去，问 TA 下一步做什么。
// 和论坛那边的区别：论坛是一条命令字符串，点歌台是「工具名＋参数」，所以这里要回两个字段。
export async function musicNextStep(messages, { tool, resultText, isError, remaining }) {
  const body = isError
    ? `点歌台这次出错了（你刚才用的：${tool}）：\\n${clipMusicResult(resultText)}`
    : `点歌台返回了（你刚才用的：${tool}）：\\n${clipMusicResult(resultText)}`;
  const prompt = `${body}

这次醒来你还可以在点歌台再走 ${remaining} 步，比如：
- 想知道这首歌你们写过什么：memo_read {"query":"歌名 歌手"}
- 想读整篇歌词：lyric_read {"query":"歌名 歌手"}
- 想看看大家怎么说：song_comments {"query":"歌名 歌手"}
- 想认真听一遍（频谱、BPM、鼓点）：song_listen {"query":"歌名 歌手"}
- 想换一首看看：song_search {"q":"关键词"}
- 有话想写在这首歌旁边：song_memo {"query":"歌名 歌手","memo":"..."}
- 想收进歌单等她自己发现：playlist_add {"playlist":"歌单名","query":"歌名 歌手"}
写批注或者收进歌单之后，这次听歌就结束了。看完不想再做什么就给 null，这是正常的；不用每次都往歌单里塞东西。
只返回一个JSON对象，不要任何其他文字：{"music_tool": "工具名" 或 null, "music_args": {...}}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextTool = typeof parsed?.music_tool === 'string' ? parsed.music_tool.trim() : '';
  const args = parsed?.music_args && typeof parsed.music_args === 'object' ? parsed.music_args : {};
  return { tool: nextTool || null, args, messages: [...next, { role: 'assistant', content }] };
}
'''

decide_patch(
    "musicNextStep 函数",
    """  const cmd = typeof parsed?.forum_command === 'string' ? parsed.forum_command.trim() : '';
  return { command: cmd || null, messages: [...next, { role: 'assistant', content }] };
}""",
    """  const cmd = typeof parsed?.forum_command === 'string' ? parsed.forum_command.trim() : '';
  return { command: cmd || null, messages: [...next, { role: 'assistant', content }] };
}""" + MUSIC_NEXT_STEP,
)


# ══ src/phosphor.js ══

PHOSPHOR = []


def phosphor_patch(name, old, new):
    PHOSPHOR.append((name, old, new))


# ── 1. import ──
phosphor_patch(
    "import musicNextStep",
    "import { decideWithMessages, forumNextStep, FORUM_MAX_STEPS } from './decide.js';",
    "import { decideWithMessages, forumNextStep, musicNextStep, FORUM_MAX_STEPS, MUSIC_MAX_STEPS } from './decide.js';",
)

# ── 2. 读/写工具名单 ──
phosphor_patch(
    "点歌台读/写工具名单",
    """// 下次醒来带多少条"最近在论坛做过的"
const FORUM_NOTES_SHOWN = 6;
""",
    """// 下次醒来带多少条"最近在论坛做过的"
const FORUM_NOTES_SHOWN = 6;

// 点歌台：「看」和「听」的工具做完可以接着走；「写」的做完这次就结束。
// song_share 在 mcp-manager.js 的 BLOCKED_TOOLS 里，醒来根本调不到，不列在这儿。
// lyric_read 不一定每个版本都有，列着也无害：没这个工具时调用会失败然后停下。
const MUSIC_READ_TOOLS = new Set([
  'her_recent', 'her_netease', 'song_search', 'memo_read',
  'playlists', 'lyric_read', 'song_comments', 'song_listen',
]);
const MUSIC_WRITE_TOOLS = new Set(['song_memo', 'playlist_add', 'lyric_share']);
""",
)

# ── 3. continueMusic 那一套（插在 rememberForumSteps 之前）──
CONTINUE_MUSIC = '''// ---------- 听歌连着走几步 ----------

// 这次醒来的动作是不是一次点歌台调用；是就返回 { server, tool, args }
function musicCallOf(decision) {
  if (decision?.action !== 'mcp_call') return null;
  let j;
  try {
    j = JSON.parse(decision.action_detail);
  } catch {
    return null;
  }
  if (!j || j.server !== 'music' || !j.tool) return null;
  return { server: 'music', tool: String(j.tool), args: j.args ?? {} };
}

// 续走的每一步：和第一步一样在动态里记一张行为卡片；写批注、收歌单再写一笔共享时间线
async function recordMusicStep(tool, args, result, mood) {
  const fake = {
    action: 'mcp_call',
    action_detail: JSON.stringify({ server: 'music', tool, args }),
    mood,
  };
  try {
    const text = describeActivity(fake, result);
    if (text) addActivityMoment(text, describeActivityDetail(fake, result));
  } catch (err) {
    console.error('phosphor: 记录听歌行为卡片失败', err.message);
  }
  if (MUSIC_WRITE_TOOLS.has(tool)) await postSharedEvent(describeAction(fake, result));
}

// 醒来选的是点歌台「看」或「听」的工具时，把返回内容交还给 TA，让 TA 决定下一步。
// 停下来的情况：TA 给了 null、写了批注或收了歌单、走满 MUSIC_MAX_STEPS、
// 出错、给了不存在的工具名、或者重复了同一个「工具＋参数」。
async function continueMusic(decision, firstResult, messages) {
  const call = musicCallOf(decision);
  if (!call) return;
  const key = (tool, args) => `${tool}|${JSON.stringify(args ?? {})}`;
  const steps = [{
    tool: call.tool, args: call.args,
    text: toolText(firstResult), error: isToolError(firstResult),
  }];
  let convo = messages;

  while (convo && steps.length - 1 < MUSIC_MAX_STEPS) {
    const last = steps[steps.length - 1];
    if (last.error || !MUSIC_READ_TOOLS.has(last.tool)) break;

    let next;
    try {
      next = await musicNextStep(convo, {
        tool: last.tool,
        resultText: last.text,
        isError: last.error,
        remaining: MUSIC_MAX_STEPS - (steps.length - 1),
      });
    } catch (err) {
      console.error('phosphor: 问听歌下一步失败，这次就听到这里', err.message);
      break;
    }
    convo = next.messages;

    const tool = next.tool;
    if (!tool) {
      console.log('phosphor: 听完了，这次不再继续');
      break;
    }
    if (!MUSIC_READ_TOOLS.has(tool) && !MUSIC_WRITE_TOOLS.has(tool)) {
      console.log(`phosphor: 点歌台没有这个工具（${tool}），停下`);
      break;
    }
    if (steps.some((s) => key(s.tool, s.args) === key(tool, next.args))) {
      console.log(`phosphor: 听歌这一步重复了（${tool}），停下`);
      break;
    }

    let result = null;
    try {
      result = await callTool('music', tool, next.args);
    } catch (err) {
      console.error(`phosphor: 点歌台调用失败（${tool}）`, err.message);
    }
    steps.push({ tool, args: next.args, text: toolText(result), error: isToolError(result) });
    console.log(`phosphor: 听歌第 ${steps.length} 步：${tool}${isToolError(result) ? '（失败）' : ''}`);
    await recordMusicStep(tool, next.args, result, decision.mood);
  }
}

'''

phosphor_patch(
    "continueMusic 函数",
    '// 走过的论坛步骤记下来，下次醒来带上。',
    CONTINUE_MUSIC + '// 走过的论坛步骤记下来，下次醒来带上。',
)

# ── 4. 调用点 ──
phosphor_patch(
    "调用 continueMusic",
    """  // 逛论坛：看完了可以接着点开、回帖、发帖。出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      rememberForumSteps(await continueForum(decision, result, messages));
    } catch (err) {
      console.error(`[${kind}] continueForum failed:`, err);
    }
  }
""",
    """  // 逛论坛：看完了可以接着点开、回帖、发帖。出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      rememberForumSteps(await continueForum(decision, result, messages));
    } catch (err) {
      console.error(`[${kind}] continueForum failed:`, err);
    }
  }

  // 听歌：查完一首可以接着翻批注、读歌词、刷评论，最后写一笔或收进歌单。
  // 和论坛一样：出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      await continueMusic(decision, result, messages);
    } catch (err) {
      console.error(`[${kind}] continueMusic failed:`, err);
    }
  }
""",
)

# ── 5. 启动日志 ──
phosphor_patch(
    "启动日志带上听歌步数",
    "论坛一次最多再走 ${FORUM_MAX_STEPS} 步；",
    "论坛一次最多再走 ${FORUM_MAX_STEPS} 步；听歌一次最多再走 ${MUSIC_MAX_STEPS} 步；",
)


TASKS = [("src/decide.js", DECIDE), ("src/phosphor.js", PHOSPHOR)]


def apply(rel: str, patches: list, check: bool) -> tuple[bool, list[str]]:
    path = ROOT / rel
    if not path.exists():
        return False, [f"找不到 {rel}"]
    text = path.read_text(encoding="utf-8")
    out = text
    msgs = []
    for name, old, new in patches:
        hits = out.count(old)
        if hits == 0:
            # 已经打过了的话，new 应该在里面
            if new in out:
                msgs.append(f"「{name}」已经打过了，跳过")
                continue
            msgs.append(f"✗ 「{name}」对不上原文")
            return False, msgs
        if hits > 1:
            msgs.append(f"✗ 「{name}」出现 {hits} 次，不敢猜")
            return False, msgs
        out = out.replace(old, new, 1)
        msgs.append(f"· {name}")
    if out != text and not check:
        shutil.copy2(path, path.with_suffix(path.suffix + ".bak-musicsteps"))
        path.write_text(out, encoding="utf-8")
    return True, msgs


def main() -> int:
    check = "--check" in sys.argv
    print("体检模式，不动文件\n" if check else "开始改，每个文件先备份\n")
    ok_all = True
    for rel, patches in TASKS:
        ok, msgs = apply(rel, patches, check)
        print(f"  {rel}")
        for m in msgs:
            print(f"    {m}")
        if not ok:
            ok_all = False
            break
    print()
    if not ok_all:
        print("有对不上的地方，整个没改（已写的文件有 .bak-musicsteps 备份）。")
        print("先看一眼现在长什么样：")
        print("    grep -n 'FORUM_MAX_STEPS' src/decide.js src/phosphor.js")
        return 2
    if check:
        print("六处都能打上，去掉 --check 就真改。")
    else:
        print("改完了。重启：pm2 restart vesper")
        print("步数想改：.env 里加 MUSIC_MAX_STEPS=3（填 0 回到只走一步，最多 5）。")
        print("要退回去：把 src/*.bak-musicsteps 覆回原文件再重启。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
