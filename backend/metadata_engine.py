"""
core/metadata_engine.py
=======================
Standalone Universal Metadata & Graph Unrolling Engine for HammelArt Atelier.

Zero hard dependencies on external tools (works out of the box on images & videos).

Supports:
1. ComfyUI API Prompt Graphs & Full Workflows (including Subgraphs, BasicGuider, FluxGuidance,
   SamplerCustomAdvanced, KSampler, MiniMaxH3ImageToVideo / ReferenceToVideo, WanVideo,
   HammelartPromptCenter, HammelartArtDirectorV2, HammelartModelBatcher).
2. Direct PNG/WebP text chunks (`hammelart_prompt`, `hammelart_parameters`, `parameters`).
3. A1111 / Civitai parameter strings.
4. Video containers (`.mp4`, `.webm`, `.mov`) via `ffprobe` stream & format tag inspection
   (with automatic `cv2.VideoCapture` fallback for dimensions, FPS, and duration when `ffprobe` is absent).
"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image

TAG_DICTIONARY = [
    # Traditional & Digital Fine Art
    "oil-painting", "watercolor", "gouache", "acrylic", "impasto", "ink", "sketch",
    "charcoal", "lineart", "pastel", "woodcut", "stained-glass", "origami", "papercraft",
    "concept-art", "digital-painting", "matte-painting", "illustration", "surrealism",
    "abstract", "minimalist", "art-nouveau", "art-deco", "baroque", "impressionism",
    "pop-art", "ukiyo-e", "gothic", "vintage", "noir",
    # Stylized, Anime & 3D
    "anime", "manga", "cel-shaded", "chibi", "mecha", "pixel-art", "isometric",
    "voxel", "low-poly", "3d-render", "octane", "claymation", "diorama", "miniature",
    # Genres, Worldbuilding & Environments
    "cyberpunk", "steampunk", "scifi", "fantasy", "dystopian", "architecture",
    "landscape", "cosmos", "space", "forest", "ocean", "desert", "mountain",
    "ruins", "castle", "cityscape", "urban", "cyber",
    # Characters, Fashion & Subjects
    "portrait", "character", "fashion", "armor", "jewelry", "glasses", "tattoo",
    "eyes", "creature", "dragon", "robot", "android", "spaceship", "vehicle", "flowers",
    # Photography, Camera & Lighting
    "photorealistic", "cinematic", "editorial", "candid", "macro", "closeup",
    "wide-angle", "low-angle", "aerial", "silhouette", "bokeh", "film-grain",
    "monochrome", "smartphone", "35mm", "85mm", "daylight", "golden-hour",
    "blue-hour", "neon", "moonlight", "candlelight", "volumetric", "chiaroscuro",
    "rim-light", "bioluminescent", "studio-lighting", "ethereal", "fog", "rain",
]


def _build_tag_regex() -> re.Pattern:
    words = list(TAG_DICTIONARY)
    custom_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "userdata", "custom_tags.json")
    )
    if os.path.isfile(custom_path):
        try:
            with open(custom_path, "r", encoding="utf-8") as f:
                extra = json.load(f)
            if isinstance(extra, list):
                for item in extra:
                    if isinstance(item, str) and item.strip():
                        words.append(item.strip().lower())
        except Exception:
            pass
    # Longer keywords first so compound terms match cleanly
    uniq = sorted(set(words), key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(re.escape(k) for k in uniq) + r")\b", re.IGNORECASE)


_TAG_REGEX = _build_tag_regex()


def extract_tags_from_text(text: str, extra_tags_str: str = "") -> List[str]:
    tags = set()
    if extra_tags_str:
        for t in extra_tags_str.split(","):
            clean = t.strip().lower().replace('"', "")
            if clean:
                tags.add(clean)
    if text:
        for match in _TAG_REGEX.findall(text.lower()):
            tags.add(match.lower())
    return sorted(tags)


def detect_model_dialect(model_name: str, sampler_name: str = "", prompt_dict: Optional[Dict[str, Any]] = None) -> str:
    m_low = (model_name or "").lower()
    s_low = (sampler_name or "").lower()
    if any(k in m_low for k in ("minimax", "wan", "hunyuan", "ltx", "mochi", "cogvideo")):
        return "Video / Cinema"
    if any(k in m_low for k in ("moss", "kromoss", "krast")):
        return "MOSS"
    if any(k in m_low for k in ("krea", "flux", "schnell")):
        return "Flux / Krea"
    if any(k in m_low for k in ("qwen", "vl")):
        return "Qwen-VL"
    if any(k in m_low for k in ("xl", "sdxl", "pony", "illustrious")):
        return "SDXL"
    if any(k in m_low for k in ("sd15", "v1-5", "1.5")):
        return "SD 1.5"
    if "taylor" in s_low or "er_sde" in s_low:
        return "Flow / SDE"
    if prompt_dict and isinstance(prompt_dict, dict):
        ctypes = " ".join(str(v.get("class_type", "")) for v in prompt_dict.values() if isinstance(v, dict)).lower()
        if "minimax" in ctypes or "wan" in ctypes:
            return "Video / Cinema"
        if "flux" in ctypes:
            return "Flux / Krea"
    return "Custom" if model_name and model_name != "Unknown" else "Standard"


def _trace_text_from_node(node_id: str, prompt: Dict[str, Any], visited: Optional[set] = None, depth: int = 0) -> str:
    if visited is None:
        visited = set()
    if depth > 14 or node_id in visited:
        return ""
    visited.add(node_id)
    node = prompt.get(str(node_id))
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    # 1. HammelartPromptCenter / PromptCenter
    if "PromptCenter" in ctype:
        payload_str = inputs.get("payload", "")
        p_data = {}
        if payload_str:
            try:
                p_data = json.loads(payload_str) if isinstance(payload_str, str) else payload_str
            except Exception:
                p_data = {}
        is_override = bool(p_data.get("override_active", False)) if isinstance(p_data, dict) else False
        p_pos = str(p_data.get("positive", p_data.get("prompt", p_data.get("text", "")))).strip() if isinstance(p_data, dict) else ""
        if is_override and p_pos:
            return p_pos
        pos_in = inputs.get("positive_in")
        if isinstance(pos_in, list) and len(pos_in) >= 1:
            traced = _trace_text_from_node(str(pos_in[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(pos_in, str) and pos_in.strip():
            return pos_in.strip()
        if p_pos:
            return p_pos

    # 2. HammelartArtDirectorV2
    if "ArtDirector" in ctype:
        for k in ("positive_prompt", "concept"):
            val = str(inputs.get(k) or "").strip()
            if val:
                return val

    # 3. MiniMax / Wan / Video Text Encoders & ImageToVideo nodes
    if any(k in ctype for k in ("MiniMax", "Wan", "Video", "CLIPTextEncode")):
        for key in ("prompt", "text", "positive_prompt", "caption"):
            t = inputs.get(key)
            if isinstance(t, list) and len(t) >= 1:
                traced = _trace_text_from_node(str(t[0]), prompt, visited, depth + 1)
                if traced:
                    return traced
            elif isinstance(t, str) and t.strip():
                return t.strip()

    # 4. Generic string/text nodes
    for key in ("text", "prompt", "string", "value", "text_positive", "positive"):
        val = inputs.get(key)
        if isinstance(val, list) and len(val) >= 1:
            traced = _trace_text_from_node(str(val[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(val, str) and val.strip():
            return val.strip()

    return ""


def _trace_negative_text_from_node(node_id: str, prompt: Dict[str, Any], visited: Optional[set] = None, depth: int = 0) -> str:
    if visited is None:
        visited = set()
    if depth > 14 or node_id in visited:
        return ""
    visited.add(node_id)
    node = prompt.get(str(node_id))
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    if "ConditioningZeroOut" in ctype:
        return ""

    if "PromptCenter" in ctype:
        payload_str = inputs.get("payload", "")
        p_data = {}
        if payload_str:
            try:
                p_data = json.loads(payload_str) if isinstance(payload_str, str) else payload_str
            except Exception:
                p_data = {}
        p_neg = str(p_data.get("negative") or "").strip() if isinstance(p_data, dict) else ""
        neg_in = inputs.get("negative_in")
        if isinstance(neg_in, list) and len(neg_in) >= 1:
            traced = _trace_negative_text_from_node(str(neg_in[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(neg_in, str) and neg_in.strip():
            return neg_in.strip()
        if p_neg:
            return p_neg

    if "ArtDirector" in ctype:
        ad_neg = str(inputs.get("negative_prompt") or "").strip()
        if ad_neg:
            return ad_neg

    for key in ("negative_prompt", "text_negative", "negative", "text", "string", "value"):
        val = inputs.get(key)
        if isinstance(val, list) and len(val) >= 1:
            traced = _trace_negative_text_from_node(str(val[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(val, str) and val.strip():
            return val.strip()

    return ""


def _trace_conditioning_upstream(cond_link: Any, prompt: Dict[str, Any], is_negative: bool = False, depth: int = 0) -> str:
    if depth > 14 or not isinstance(cond_link, list) or len(cond_link) < 1:
        return ""

    node_id = str(cond_link[0])
    node = prompt.get(node_id)
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    if "ConditioningZeroOut" in ctype:
        return ""

    # Guider nodes (CFGGuider, BasicGuider, DualCFGGuider)
    if "Guider" in ctype:
        if is_negative:
            if "negative" in inputs:
                return _trace_conditioning_upstream(inputs["negative"], prompt, True, depth + 1)
            return ""
        else:
            for k in ("positive", "conditioning", "cond"):
                if k in inputs:
                    res = _trace_conditioning_upstream(inputs[k], prompt, False, depth + 1)
                    if res:
                        return res

    # Conditioning modifiers
    for c_key in ("conditioning", "conditioning_to", "conditioning_from", "conditioning_1", "positive"):
        if c_key in inputs and isinstance(inputs[c_key], list):
            res = _trace_conditioning_upstream(inputs[c_key], prompt, is_negative, depth + 1)
            if res:
                return res

    fn = _trace_negative_text_from_node if is_negative else _trace_text_from_node
    return fn(node_id, prompt, set(), 0)


def _find_active_sampler_node(prompt: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
    # 1. Trace backwards from SaveImage / ImageCurator / VideoCombine through Decode
    for node_id, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type", ""))
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        if any(k in ctype for k in ("ImageCurator", "SaveImage", "VideoCombine", "SaveVideo")):
            img_link = inputs.get("images") or inputs.get("video")
            if isinstance(img_link, list) and len(img_link) >= 1:
                dec_node = prompt.get(str(img_link[0]), {})
                if isinstance(dec_node, dict):
                    d_inputs = dec_node.get("inputs", {})
                    samples_link = d_inputs.get("samples") or d_inputs.get("latent")
                    if isinstance(samples_link, list) and len(samples_link) >= 1:
                        s_id = str(samples_link[0])
                        s_node = prompt.get(s_id)
                        if isinstance(s_node, dict):
                            return (s_id, s_node)

    # 2. Fallback scan for any sampler node
    for node_id, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type", ""))
        if any(k in ctype for k in ("KSampler", "SamplerCustom", "ClownsharK", "SamplerER")):
            return (node_id, node)
    return None


def _resolve_seed_val(val: Any, p_dict: Dict[str, Any], depth: int = 0) -> Any:
    if depth > 8 or val is None:
        return "Unknown"
    if isinstance(val, (int, float)):
        return int(val)
    if isinstance(val, str) and val.strip().isdigit():
        return int(val.strip())
    if isinstance(val, list) and len(val) >= 1:
        src_node = p_dict.get(str(val[0]), {})
        if isinstance(src_node, dict):
            src_inputs = src_node.get("inputs", {})
            if "payload" in src_inputs:
                try:
                    sp = json.loads(src_inputs["payload"]) if isinstance(src_inputs["payload"], str) else src_inputs["payload"]
                    if isinstance(sp, dict) and "seed" in sp and isinstance(sp["seed"], (int, float)):
                        return int(sp["seed"])
                except Exception:
                    pass
            for sk in ("seed", "noise_seed", "seed_a", "value"):
                if sk in src_inputs:
                    res = _resolve_seed_val(src_inputs[sk], p_dict, depth + 1)
                    if res != "Unknown":
                        return res
    return "Unknown"


def parse_comfy_graph(prompt: Any) -> Dict[str, Any]:
    pos_prompt = ""
    neg_prompt = ""
    seed: Any = "Unknown"
    steps: Any = "Unknown"
    sampler: Any = "Unknown"
    cfg: Any = "Unknown"
    model_name = "Unknown"

    if isinstance(prompt, str):
        try:
            prompt = json.loads(prompt)
        except Exception:
            prompt = None

    if not isinstance(prompt, dict):
        return {
            "positive": "",
            "negative": "",
            "seed": "Unknown",
            "steps": "Unknown",
            "sampler": "Unknown",
            "cfg": "Unknown",
            "model": "Unknown",
        }

    active_sampler = _find_active_sampler_node(prompt)
    if active_sampler:
        _, s_node = active_sampler
        s_inputs = s_node.get("inputs", {}) if isinstance(s_node, dict) else {}

        if "positive" in s_inputs:
            pos_prompt = _trace_conditioning_upstream(s_inputs["positive"], prompt, False)
        elif "guider" in s_inputs:
            pos_prompt = _trace_conditioning_upstream(s_inputs["guider"], prompt, False)

        if "negative" in s_inputs:
            neg_prompt = _trace_conditioning_upstream(s_inputs["negative"], prompt, True)
        elif "guider" in s_inputs:
            neg_prompt = _trace_conditioning_upstream(s_inputs["guider"], prompt, True)

        s_val = s_inputs.get("seed", s_inputs.get("noise_seed", s_inputs.get("seed_a")))
        seed = _resolve_seed_val(s_val, prompt)
        if seed == "Unknown" and "noise" in s_inputs and isinstance(s_inputs["noise"], list) and len(s_inputs["noise"]) >= 1:
            noise_node = prompt.get(str(s_inputs["noise"][0]), {})
            if isinstance(noise_node, dict):
                n_in = noise_node.get("inputs", {})
                for sk in ("noise_seed", "seed", "seed_a"):
                    if sk in n_in:
                        seed = _resolve_seed_val(n_in[sk], prompt)
                        if seed != "Unknown":
                            break

        if "steps" in s_inputs:
            st_val = s_inputs["steps"]
            if isinstance(st_val, (int, float)):
                steps = int(st_val)
            elif isinstance(st_val, list) and len(st_val) >= 1:
                src_node = prompt.get(str(st_val[0]), {})
                if isinstance(src_node, dict):
                    steps = src_node.get("inputs", {}).get("value", steps)
        elif "sigmas" in s_inputs and isinstance(s_inputs["sigmas"], list) and len(s_inputs["sigmas"]) >= 1:
            sched_node = prompt.get(str(s_inputs["sigmas"][0]), {})
            if isinstance(sched_node, dict):
                st = sched_node.get("inputs", {}).get("steps")
                if isinstance(st, (int, float)):
                    steps = int(st)

        if "cfg" in s_inputs:
            c_val = s_inputs["cfg"]
            if isinstance(c_val, (int, float)):
                cfg = round(float(c_val), 1)
        elif "guider" in s_inputs and isinstance(s_inputs["guider"], list) and len(s_inputs["guider"]) >= 1:
            g_node = prompt.get(str(s_inputs["guider"][0]), {})
            if isinstance(g_node, dict):
                c_val = g_node.get("inputs", {}).get("cfg")
                if isinstance(c_val, (int, float)):
                    cfg = round(float(c_val), 1)

        if "sampler_name" in s_inputs and isinstance(s_inputs["sampler_name"], str):
            sampler = s_inputs["sampler_name"]
        elif "sampler" in s_inputs and isinstance(s_inputs["sampler"], list) and len(s_inputs["sampler"]) >= 1:
            samp_node = prompt.get(str(s_inputs["sampler"][0]), {})
            if isinstance(samp_node, dict):
                s_name = samp_node.get("inputs", {}).get("sampler_name")
                sampler = s_name if (isinstance(s_name, str) and s_name) else str(samp_node.get("class_type", sampler))

        # Trace model upstream
        model_wire = s_inputs.get("model")
        if not model_wire and "guider" in s_inputs and isinstance(s_inputs["guider"], list) and len(s_inputs["guider"]) >= 1:
            g_node = prompt.get(str(s_inputs["guider"][0]), {})
            if isinstance(g_node, dict):
                model_wire = g_node.get("inputs", {}).get("model")

        curr_link = model_wire
        for _ in range(10):
            if isinstance(curr_link, list) and len(curr_link) >= 1:
                up_node = prompt.get(str(curr_link[0]))
                if not isinstance(up_node, dict):
                    break
                up_ctype = str(up_node.get("class_type", ""))
                up_in = up_node.get("inputs", {})
                if not isinstance(up_in, dict):
                    break
                if "ModelBatcher" in up_ctype:
                    try:
                        mb_data = json.loads(up_in.get("payload", "{}"))
                        act = [m["model"] for m in mb_data.get("batch_models", []) if m.get("active") and m.get("model")]
                        if act:
                            model_name = act[0]
                    except Exception:
                        pass
                    break
                elif any(k in up_ctype for k in ("CheckpointLoader", "UNETLoader", "DiffusionModelLoader")):
                    model_name = str(up_in.get("ckpt_name", up_in.get("unet_name", up_in.get("model_name", model_name))))
                    break
                elif "model" in up_in:
                    curr_link = up_in["model"]
                else:
                    break
            else:
                break

    # Fallbacks for any missing fields
    if not pos_prompt:
        for node in prompt.values():
            if not isinstance(node, dict):
                continue
            ctype = str(node.get("class_type", ""))
            inputs = node.get("inputs", {})
            if not isinstance(inputs, dict):
                continue
            if "PromptCenter" in ctype:
                try:
                    p_data = json.loads(inputs.get("payload", "{}"))
                    if isinstance(p_data, dict) and p_data.get("positive"):
                        pos_prompt = str(p_data["positive"]).strip()
                        if not neg_prompt and p_data.get("negative"):
                            neg_prompt = str(p_data["negative"]).strip()
                        break
                except Exception:
                    pass
            elif "ArtDirector" in ctype:
                p = str(inputs.get("positive_prompt") or inputs.get("concept") or "").strip()
                if p:
                    pos_prompt = p
                    break
            elif any(k in ctype for k in ("MiniMax", "CLIPTextEncode", "Wan")):
                for tk in ("prompt", "text"):
                    tv = inputs.get(tk)
                    if isinstance(tv, str) and len(tv.strip()) > len(pos_prompt):
                        pos_prompt = tv.strip()

    if model_name == "Unknown":
        for node in prompt.values():
            if not isinstance(node, dict):
                continue
            ctype = str(node.get("class_type", ""))
            inputs = node.get("inputs", {})
            if isinstance(inputs, dict) and any(k in ctype for k in ("CheckpointLoader", "UNETLoader")):
                name = inputs.get("ckpt_name") or inputs.get("unet_name")
                if name:
                    model_name = str(name)
                    break

    pos_prompt = pos_prompt.strip()
    neg_prompt = neg_prompt.strip()

    return {
        "positive": pos_prompt,
        "negative": neg_prompt,
        "seed": seed,
        "steps": steps,
        "sampler": sampler,
        "cfg": cfg,
        "model": model_name,
    }


def parse_a1111_string(text: str) -> Dict[str, str]:
    res = {
        "positive": "",
        "negative": "",
        "model": "Unknown",
        "steps": "Unknown",
        "sampler": "Unknown",
        "cfg": "Unknown",
        "seed": "Unknown",
    }
    if not text or not isinstance(text, str):
        return res

    text = text.strip()
    parts = re.split(r"(?i)\nNegative prompt:\s*", text, maxsplit=1)
    if len(parts) > 1:
        res["positive"] = parts[0].strip()
        rest = parts[1]
        step_m = re.search(r"(?:^|\n)(Steps:\s*\d+.*)", rest, re.IGNORECASE | re.DOTALL)
        if step_m:
            res["negative"] = rest[:step_m.start()].strip()
            param_line = step_m.group(1)
        else:
            res["negative"] = rest.strip()
            param_line = ""
    else:
        rest = parts[0]
        step_m = re.search(r"(?:^|\n)(Steps:\s*\d+.*)", rest, re.IGNORECASE | re.DOTALL)
        if step_m:
            res["positive"] = rest[:step_m.start()].strip()
            param_line = step_m.group(1)
        else:
            res["positive"] = rest.strip()
            param_line = ""

    if param_line:
        for pat, key in [
            (r"(?i)Steps:\s*(\d+)", "steps"),
            (r"(?i)Sampler:\s*([^,\n]+)", "sampler"),
            (r"(?i)CFG scale:\s*([\d.]+)", "cfg"),
            (r"(?i)Seed:\s*(\d+)", "seed"),
            (r"(?i)Model:\s*([^,\n]+)", "model"),
        ]:
            m = re.search(pat, param_line)
            if m:
                res[key] = m.group(1).strip()

    return res


def extract_media_metadata(file_path: str) -> Dict[str, Any]:
    """
    Universal metadata extractor for both Images (.png, .webp, .jpg) and Videos (.mp4, .webm, .mov).
    """
    ext = os.path.splitext(file_path)[1].lower()
    is_video = ext in (".mp4", ".webm", ".mov", ".mkv")
    file_size_bytes = os.path.getsize(file_path) if os.path.exists(file_path) else 0
    file_size_mb = round(file_size_bytes / (1024 * 1024), 2)

    width = 0
    height = 0
    duration_sec = 0.0
    has_audio = False
    raw_prompt = ""
    negative_prompt = ""
    seed = "Unknown"
    sampler = "Unknown"
    steps = "Unknown"
    cfg = "Unknown"
    model_name = "Unknown"
    workflow: Dict[str, Any] = {}
    prompt_dict: Dict[str, Any] = {}
    extra_tags_str = ""

    if is_video:
        try:
            creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            out = subprocess.check_output(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file_path],
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=4,
                creationflags=creation_flags,
            )
            probe = json.loads(out)
            for stream in probe.get("streams", []):
                stype = stream.get("codec_type")
                if stype == "video" and width == 0:
                    width = int(stream.get("width") or 0)
                    height = int(stream.get("height") or 0)
                    if stream.get("duration"):
                        duration_sec = round(float(stream["duration"]), 2)
                elif stype == "audio":
                    has_audio = True

            fmt = probe.get("format", {})
            if not duration_sec and fmt.get("duration"):
                duration_sec = round(float(fmt["duration"]), 2)

            tags_obj = fmt.get("tags", {}) or {}
            # Case-insensitive lookup for prompt & workflow in container tags
            for k, v in tags_obj.items():
                kl = k.lower()
                if kl == "workflow" and isinstance(v, str):
                    try:
                        workflow = json.loads(v)
                    except Exception:
                        pass
                elif kl in ("prompt", "comment") and isinstance(v, str):
                    try:
                        parsed_json = json.loads(v)
                        if isinstance(parsed_json, dict):
                            if "nodes" in parsed_json and not workflow:
                                workflow = parsed_json
                            else:
                                prompt_dict = parsed_json
                    except Exception:
                        if not raw_prompt:
                            raw_prompt = v.strip()
        except Exception:
            pass

        # Fallback to OpenCV (cv2.VideoCapture) when ffprobe is unavailable or incomplete
        if width == 0 or height == 0 or duration_sec == 0.0:
            cap = None
            try:
                import cv2

                cap = cv2.VideoCapture(file_path)
                if cap and cap.isOpened():
                    if width == 0:
                        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
                    if height == 0:
                        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
                    if duration_sec == 0.0:
                        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
                        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
                        if fps > 0.0 and frames > 0.0:
                            duration_sec = round(frames / fps, 2)
            except Exception:
                pass
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass

        if prompt_dict:
            g_meta = parse_comfy_graph(prompt_dict)
            raw_prompt = g_meta["positive"] or raw_prompt
            negative_prompt = g_meta["negative"] or negative_prompt
            seed = str(g_meta["seed"])
            sampler = str(g_meta["sampler"])
            steps = str(g_meta["steps"])
            cfg = str(g_meta["cfg"])
            model_name = str(g_meta["model"])

        if model_name == "Unknown":
            model_name = "Video Render"

    else:
        try:
            with Image.open(file_path) as img:
                width, height = img.size
                info = getattr(img, "info", {}) or {}

                extra_tags_str = str(info.get("hammelart_tags") or info.get("tags") or "")

                # 1. Direct first-class metadata chunks
                for prefix in ("hammelart_",):
                    if info.get(f"{prefix}prompt") and not raw_prompt:
                        raw_prompt = str(info[f"{prefix}prompt"]).strip()
                    if info.get(f"{prefix}negative") and not negative_prompt:
                        negative_prompt = str(info[f"{prefix}negative"]).strip()
                    if info.get(f"{prefix}seed") and seed == "Unknown":
                        seed = str(info[f"{prefix}seed"])
                    if info.get(f"{prefix}sampler") and sampler == "Unknown":
                        sampler = str(info[f"{prefix}sampler"])
                    if info.get(f"{prefix}steps") and steps == "Unknown":
                        steps = str(info[f"{prefix}steps"])
                    if info.get(f"{prefix}cfg") and cfg == "Unknown":
                        cfg = str(info[f"{prefix}cfg"])
                    if info.get(f"{prefix}model") and model_name == "Unknown":
                        model_name = str(info[f"{prefix}model"])

                # 2. A1111 / Parameters block
                param_str = (
                    info.get("hammelart_parameters")
                    or info.get("parameters")
                    or ""
                )
                if param_str and isinstance(param_str, str):
                    a_meta = parse_a1111_string(param_str)
                    if not raw_prompt and a_meta["positive"]:
                        raw_prompt = a_meta["positive"]
                    if not negative_prompt and a_meta["negative"]:
                        negative_prompt = a_meta["negative"]
                    if seed == "Unknown" and a_meta["seed"] != "Unknown":
                        seed = a_meta["seed"]
                    if sampler == "Unknown" and a_meta["sampler"] != "Unknown":
                        sampler = a_meta["sampler"]
                    if steps == "Unknown" and a_meta["steps"] != "Unknown":
                        steps = a_meta["steps"]
                    if cfg == "Unknown" and a_meta["cfg"] != "Unknown":
                        cfg = a_meta["cfg"]
                    if model_name == "Unknown" and a_meta["model"] != "Unknown":
                        model_name = a_meta["model"]

                # 3. ComfyUI workflow & prompt JSON chunks
                if "workflow" in info:
                    try:
                        workflow = json.loads(info["workflow"]) if isinstance(info["workflow"], str) else info["workflow"]
                    except Exception:
                        workflow = {}

                if "prompt" in info:
                    try:
                        prompt_dict = json.loads(info["prompt"]) if isinstance(info["prompt"], str) else info["prompt"]
                    except Exception:
                        prompt_dict = {}

                if prompt_dict:
                    g_meta = parse_comfy_graph(prompt_dict)
                    if not raw_prompt and g_meta["positive"]:
                        raw_prompt = g_meta["positive"]
                    if not negative_prompt and g_meta["negative"]:
                        negative_prompt = g_meta["negative"]
                    if seed == "Unknown" and g_meta["seed"] != "Unknown":
                        seed = str(g_meta["seed"])
                    if sampler == "Unknown" and g_meta["sampler"] != "Unknown":
                        sampler = str(g_meta["sampler"])
                    if steps == "Unknown" and g_meta["steps"] != "Unknown":
                        steps = str(g_meta["steps"])
                    if cfg == "Unknown" and g_meta["cfg"] != "Unknown":
                        cfg = str(g_meta["cfg"])
                    if model_name == "Unknown" and g_meta["model"] != "Unknown":
                        model_name = str(g_meta["model"])
        except Exception as exc:
            print(f"[HammelArt Atelier] Metadata read warning on {os.path.basename(file_path)}: {exc}")

    # Aspect bucket calculation
    aspect_bucket = "square"
    aspect_ratio_val = 1.0
    if width > 0 and height > 0:
        aspect_ratio_val = round(width / height, 4)
        if aspect_ratio_val > 1.12:
            aspect_bucket = "landscape"
        elif aspect_ratio_val < 0.88:
            aspect_bucket = "portrait"

    dialect = detect_model_dialect(model_name, sampler, prompt_dict)
    tags = extract_tags_from_text(raw_prompt, extra_tags_str)
    has_workflow = bool(workflow and isinstance(workflow, dict) and len(workflow) > 0)

    short_model = os.path.basename(model_name.replace("\\", "/")) if model_name and model_name != "Unknown" else model_name
    if short_model.endswith(".safetensors"):
        short_model = short_model[:-12]
    elif short_model.endswith(".ckpt"):
        short_model = short_model[:-5]

    return {
        "width": width,
        "height": height,
        "resolution": f"{width}x{height}" if (width and height) else "Unknown",
        "aspect_ratio": aspect_ratio_val,
        "aspect_bucket": aspect_bucket,
        "media_type": "video" if is_video else "image",
        "duration_sec": duration_sec,
        "has_audio": has_audio,
        "file_size_bytes": file_size_bytes,
        "file_size_mb": file_size_mb,
        "model": model_name,
        "model_short": short_model,
        "dialect": dialect,
        "seed": str(seed),
        "sampler": str(sampler),
        "steps": str(steps),
        "cfg": str(cfg),
        "raw_prompt": raw_prompt,
        "negative_prompt": negative_prompt,
        "tags": tags,
        "has_workflow": has_workflow,
        "workflow": workflow,
    }
