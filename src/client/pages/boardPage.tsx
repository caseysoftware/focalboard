import React from "react"
import ReactDOM from "react-dom"
import { BoardTree } from "../boardTree"
import { BoardView } from "../boardView"
import { Card } from "../card"
import { CardTree } from "../cardTree"
import { CardDialog } from "../components/cardDialog"
import { FilterComponent } from "../components/filterComponent"
import { WorkspaceComponent } from "../components/workspaceComponent"
import { FlashMessage } from "../flashMessage"
import { Mutator } from "../mutator"
import { OctoClient } from "../octoClient"
import { OctoListener } from "../octoListener"
import { UndoManager } from "../undomanager"
import { Utils } from "../utils"
import { WorkspaceTree } from "../workspaceTree"

type Props = {
}

type State = {
	boardId: string
	viewId: string
	workspaceTree: WorkspaceTree
	boardTree?: BoardTree
	shownCardTree?: CardTree
}

export default class BoardPage extends React.Component<Props, State> {
	view: BoardView

	updateTitleTimeout: number
	updatePropertyLabelTimeout: number

	private filterAnchorElement?: HTMLElement
	private octo = new OctoClient()
	private boardListener = new OctoListener()
	private cardListener = new OctoListener()

	constructor(props: Props) {
		super(props)
		const queryString = new URLSearchParams(window.location.search)
		const boardId = queryString.get("id")
		const viewId = queryString.get("v")

		this.state = {
			boardId,
			viewId,
			workspaceTree: new WorkspaceTree(this.octo),
		}

		Utils.log(`BoardPage. boardId: ${boardId}`)
	}

	componentDidUpdate(prevProps: Props, prevState: State) {
		Utils.log(`componentDidUpdate`)
		const board = this.state.boardTree?.board
		const prevBoard = prevState.boardTree?.board

		const activeView = this.state.boardTree?.activeView
		const prevActiveView = prevState.boardTree?.activeView

		if (board?.icon !== prevBoard?.icon) {
			Utils.setFavicon(board?.icon)
		}
		if (board?.title !== prevBoard?.title || activeView?.title !== prevActiveView?.title) {
			document.title = `OCTO - ${board?.title} | ${activeView?.title}`
		}
	}

	undoRedoHandler = async (e: KeyboardEvent) => {
		if (e.target !== document.body) { return }

		if (e.keyCode === 90 && !e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {		// Cmd+Z
			Utils.log(`Undo`)
			const description = UndoManager.shared.undoDescription
			await UndoManager.shared.undo()
			if (description) {
				FlashMessage.show(`Undo ${description}`)
			} else {
				FlashMessage.show(`Undo`)
			}
		} else if (e.keyCode === 90 && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {		// Shift+Cmd+Z
			Utils.log(`Redo`)
			const description = UndoManager.shared.redoDescription
			await UndoManager.shared.redo()
			if (description) {
				FlashMessage.show(`Redo ${description}`)
			} else {
				FlashMessage.show(`Redo`)
			}
		}
	}

	componentDidMount() {
		document.addEventListener("keydown", this.undoRedoHandler)
		if (this.state.boardId) {
			this.attachToBoard(this.state.boardId, this.state.viewId)
		} else {
			this.sync()
		}
	}

	componentWillUnmount() {
		document.removeEventListener("keydown", this.undoRedoHandler)
	}

	render() {
		const { workspaceTree, shownCardTree } = this.state
		const { board, activeView } = this.state.boardTree || {}
		const mutator = new Mutator(this.octo)

		// TODO Move all this into the root portal component when that is merged
		if (this.state.boardTree && this.state.boardTree.board && shownCardTree) {
			ReactDOM.render(
				<CardDialog mutator={mutator} boardTree={this.state.boardTree} cardTree={shownCardTree} onClose={() => { this.showCard(undefined) }}></CardDialog>,
				Utils.getElementById("overlay")
			)
		} else {
			const overlay = document.getElementById("overlay")
			if (overlay) {
				ReactDOM.render(
					<div />,
					overlay
				)
			}
		}

		if (this.filterAnchorElement) {
			const element = this.filterAnchorElement
			const bodyRect = document.body.getBoundingClientRect()
			const rect = element.getBoundingClientRect()
			// Show at bottom-left of element
			const maxX = bodyRect.right - 420 - 100
			const pageX = Math.min(maxX, rect.left - bodyRect.left)
			const pageY = rect.bottom - bodyRect.top

			ReactDOM.render(
				<FilterComponent
					mutator={mutator}
					boardTree={this.state.boardTree}
					pageX={pageX}
					pageY={pageY}
					onClose={() => { this.showFilter(undefined) }}
				>
				</FilterComponent>,
				Utils.getElementById("modal")
			)
		} else {
			const modal = document.getElementById("modal")
			if (modal) {
				ReactDOM.render(<div />, modal)
			}
		}

		Utils.log(`BoardPage.render ${this.state.boardTree?.board?.title}`)
		return (
			<div className='BoardPage'>
				<WorkspaceComponent
					mutator={mutator}
					workspaceTree={workspaceTree}
					boardTree={this.state.boardTree}
					showView={(id) => { this.showView(id) }}
					showCard={(card) => { this.showCard(card) }}
					showBoard={(id) => { this.showBoard(id) }}
					showFilter={(el) => { this.showFilter(el) }}
					setSearchText={(text) => { this.setSearchText(text) }} />
			</div>
		)
	}

	private async attachToBoard(boardId: string, viewId?: string) {
		Utils.log(`attachToBoard: ${boardId}`)

		this.boardListener.open(boardId, (blockId: string) => {
			console.log(`octoListener.onChanged: ${blockId}`)
			this.sync(boardId)
		})

		this.sync(boardId, viewId)
	}

	async sync(boardId: string = this.state.boardId, viewId: string | undefined = this.state.viewId) {
		const { workspaceTree } = this.state
		Utils.log(`sync start: ${boardId}`)

		await workspaceTree.sync()

		if (boardId) {
			const boardTree = new BoardTree(this.octo, boardId)
			await boardTree.sync()

			// Default to first view
			if (!viewId) {
				viewId = boardTree.views[0].id
			}

			boardTree.setActiveView(viewId)
			// TODO: Handle error (viewId not found)
			this.setState({
				...this.state,
				boardTree,
				viewId: boardTree.activeView.id
			})
			Utils.log(`sync complete: ${boardTree.board.id} (${boardTree.board.title})`)
		} else {
			this.forceUpdate()
		}
	}

	// IPageController

	async showCard(card: Card) {
		this.cardListener.close()

		if (card) {
			const cardTree = new CardTree(this.octo, card.id)
			await cardTree.sync()
			this.setState({...this.state, shownCardTree: cardTree})

			this.cardListener = new OctoListener()
			this.cardListener.open(card.id, async () => {
				await cardTree.sync()
				this.forceUpdate()
			})
		} else {
			this.setState({...this.state, shownCardTree: undefined})
		}
	}

	showBoard(boardId: string) {
		const { boardTree } = this.state

		if (boardTree?.board?.id === boardId) { return }

		const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?id=${encodeURIComponent(boardId)}`
		window.history.pushState({ path: newUrl }, "", newUrl)

		this.attachToBoard(boardId)
	}

	showView(viewId: string) {
		this.state.boardTree.setActiveView(viewId)
		this.setState({ viewId, boardTree: this.state.boardTree })
		const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?id=${encodeURIComponent(this.state.boardId)}&v=${encodeURIComponent(viewId)}`
		window.history.pushState({ path: newUrl }, "", newUrl)
	}

	showFilter(ahchorElement?: HTMLElement) {
		this.filterAnchorElement = ahchorElement
	}

	setSearchText(text?: string) {
		this.state.boardTree?.setSearchText(text)
	}
}
